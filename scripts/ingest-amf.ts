/**
 * AMF / ACPR French Financial Regulation Ingestion Crawler
 *
 * Scrapes amf-france.org to populate the SQLite database with:
 *   - Règlement Général provisions (Books I–VII, article-level granularity)
 *   - AMF Doctrine documents (positions, recommendations, instructions)
 *   - Enforcement decisions (Commission des sanctions press releases)
 *
 * Data is stored in French — the primary language of the AMF.
 *
 * Usage:
 *   npx tsx scripts/ingest-amf.ts                 # full crawl
 *   npx tsx scripts/ingest-amf.ts --resume        # skip already-ingested references
 *   npx tsx scripts/ingest-amf.ts --dry-run       # parse and log, do not write to DB
 *   npx tsx scripts/ingest-amf.ts --force          # drop DB and recreate before crawling
 *   npx tsx scripts/ingest-amf.ts --resume --dry-run  # combinable
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import * as cheerio from "cheerio";
import { SCHEMA_SQL } from "../src/db.js";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const DB_PATH = process.env["AMF_DB_PATH"] ?? "data/amf.db";
const BASE_URL = "https://www.amf-france.org";
const RATE_LIMIT_MS = 1_500;
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 5_000;
const REQUEST_TIMEOUT_MS = 30_000;

const USER_AGENT =
  "Ansvar-AMF-Crawler/1.0 (+https://ansvar.eu; compliance research)";

// CLI flags
const args = process.argv.slice(2);
const FLAG_RESUME = args.includes("--resume");
const FLAG_DRY_RUN = args.includes("--dry-run");
const FLAG_FORCE = args.includes("--force");

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

function log(level: "INFO" | "WARN" | "ERROR", msg: string): void {
  const ts = new Date().toISOString();
  const prefix = `[${ts}] [${level}]`;
  if (level === "ERROR") {
    console.error(`${prefix} ${msg}`);
  } else if (level === "WARN") {
    console.warn(`${prefix} ${msg}`);
  } else {
    console.log(`${prefix} ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// HTTP helpers with rate limiting and retry
// ---------------------------------------------------------------------------

let lastRequestTime = 0;

async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const elapsed = now - lastRequestTime;
  if (elapsed < RATE_LIMIT_MS) {
    await sleep(RATE_LIMIT_MS - elapsed);
  }
  lastRequestTime = Date.now();

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "fr-FR,fr;q=0.9",
      },
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchWithRetry(url: string): Promise<string | null> {
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await rateLimitedFetch(url);
      if (response.status === 404) {
        log("WARN", `404 Not Found: ${url}`);
        return null;
      }
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      return await response.text();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log(
        "WARN",
        `Attempt ${attempt}/${MAX_RETRIES} failed for ${url}: ${msg}`,
      );
      if (attempt < MAX_RETRIES) {
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  log("ERROR", `All ${MAX_RETRIES} attempts failed for ${url}`);
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Database bootstrap
// ---------------------------------------------------------------------------

function initDb(): Database.Database {
  const dir = dirname(DB_PATH);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    log("INFO", `Created data directory: ${dir}`);
  }

  if (FLAG_FORCE && existsSync(DB_PATH)) {
    unlinkSync(DB_PATH);
    log("INFO", `Deleted existing database: ${DB_PATH}`);
  }

  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(SCHEMA_SQL);
  log("INFO", `Database initialised: ${DB_PATH}`);
  return db;
}

// ---------------------------------------------------------------------------
// Sourcebook definitions
// ---------------------------------------------------------------------------

interface SourcebookDef {
  id: string;
  name: string;
  description: string;
}

const SOURCEBOOKS: SourcebookDef[] = [
  {
    id: "AMF_Reglement_General",
    name: "Règlement Général de l'AMF",
    description:
      "Règlement général de l'Autorité des marchés financiers couvrant la prestation de services d'investissement, les infrastructures de marché, la gestion collective, l'information financière et les offres au public (livres I à VII).",
  },
  {
    id: "AMF_Positions",
    name: "Positions-Recommandations de l'AMF",
    description:
      "Documents de doctrine AMF précisant l'interprétation des textes réglementaires et les bonnes pratiques attendues des professionnels, notamment en matière de cybersécurité, de gouvernance des produits et de commercialisation.",
  },
  {
    id: "AMF_Doctrine",
    name: "Doctrine AMF",
    description:
      "Corpus doctrinal de l'AMF comprenant guides, questions-réponses et recommandations thématiques sur la surveillance des marchés, la détection des abus de marché et les obligations de transparence.",
  },
  {
    id: "AMF_Instructions",
    name: "Instructions de l'AMF",
    description:
      "Instructions de l'AMF fixant les modalités de mise en oeuvre des exigences réglementaires applicables aux acteurs des marchés financiers.",
  },
  {
    id: "ACPR_Instructions",
    name: "Instructions de l'ACPR",
    description:
      "Instructions de l'Autorité de contrôle prudentiel et de résolution fixant les modalités déclaratives et de mise en oeuvre des exigences prudentielles applicables aux établissements de crédit, entreprises d'assurance et prestataires de services de paiement.",
  },
  {
    id: "ACPR_Recommandations",
    name: "Recommandations de l'ACPR",
    description:
      "Recommandations de l'ACPR précisant les attentes prudentielles en matière de gouvernance, de gestion des risques, d'externalisation et de continuité d'activité pour les entités soumises à son contrôle.",
  },
];

function ensureSourcebooks(db: Database.Database): void {
  const insert = db.prepare(
    "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
  );
  const tx = db.transaction(() => {
    for (const sb of SOURCEBOOKS) {
      insert.run(sb.id, sb.name, sb.description);
    }
  });
  tx();
  log("INFO", `${SOURCEBOOKS.length} sourcebooks ensured`);
}

// ---------------------------------------------------------------------------
// Resume tracking
// ---------------------------------------------------------------------------

function getExistingReferences(db: Database.Database): Set<string> {
  if (!FLAG_RESUME) return new Set();
  const rows = db
    .prepare("SELECT reference FROM provisions")
    .all() as Array<{ reference: string }>;
  const refs = new Set(rows.map((r) => r.reference));
  log("INFO", `Resume mode: ${refs.size} existing provisions will be skipped`);
  return refs;
}

function getExistingEnforcementRefs(db: Database.Database): Set<string> {
  if (!FLAG_RESUME) return new Set();
  const rows = db
    .prepare(
      "SELECT reference_number FROM enforcement_actions WHERE reference_number IS NOT NULL",
    )
    .all() as Array<{ reference_number: string }>;
  const refs = new Set(rows.map((r) => r.reference_number));
  log(
    "INFO",
    `Resume mode: ${refs.size} existing enforcement actions will be skipped`,
  );
  return refs;
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

interface CrawlStats {
  provisionsInserted: number;
  provisionsSkipped: number;
  enforcementInserted: number;
  enforcementSkipped: number;
  pagesVisited: number;
  errors: number;
}

const stats: CrawlStats = {
  provisionsInserted: 0,
  provisionsSkipped: 0,
  enforcementInserted: 0,
  enforcementSkipped: 0,
  pagesVisited: 0,
  errors: 0,
};

// ---------------------------------------------------------------------------
// 1. Règlement Général crawler
// ---------------------------------------------------------------------------

/**
 * AMF General Regulation URL structure (ELI-based):
 *   /fr/eli/fr/aai/amf/rg/en-vigueur/notes                — top-level ToC
 *   /fr/eli/fr/aai/amf/rg/en-vigueur/livre/{N}/notes       — book-level ToC
 *   /fr/eli/fr/aai/amf/rg/en-vigueur/livre/{N}/titre/{T}/chapitre/{C}/notes
 *   /fr/eli/fr/aai/amf/rg/article/{NUM}/{DATE}/notes       — individual article
 *
 * The chapter-level pages contain the full article text inline, which is
 * more efficient than fetching each article individually.
 */

const RG_BOOKS: Array<{ num: string; name: string; chapter: string }> = [
  { num: "1", name: "L'Autorité des marchés financiers", chapter: "I" },
  {
    num: "2",
    name: "Émetteurs et information financière",
    chapter: "II",
  },
  { num: "3", name: "Prestataires", chapter: "III" },
  {
    num: "4",
    name: "Produits d'épargne collective",
    chapter: "IV",
  },
  { num: "5", name: "Infrastructures de marché", chapter: "V" },
  { num: "6", name: "Abus de marché", chapter: "VI" },
  { num: "7", name: "Actifs numériques", chapter: "VII" },
];

/** Discover chapter/section page URLs from a book-level ToC. */
async function discoverBookSections(
  bookNum: string,
): Promise<string[]> {
  const bookUrl = `${BASE_URL}/fr/eli/fr/aai/amf/rg/en-vigueur/livre/${bookNum}/notes`;
  const html = await fetchWithRetry(bookUrl);
  if (!html) return [];
  stats.pagesVisited++;

  const $ = cheerio.load(html);
  const sectionUrls: string[] = [];

  // Collect links that drill into titre/chapitre/section levels.
  // These pages contain the actual article text.
  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href");
    if (!href) return;

    // Match chapter-level or section-level URLs within this book
    const isChapter =
      href.includes(`/livre/${bookNum}/`) &&
      href.includes("/chapitre/") &&
      href.endsWith("/notes");
    const isTitre =
      href.includes(`/livre/${bookNum}/`) &&
      href.includes("/titre/") &&
      !href.includes("/chapitre/") &&
      href.endsWith("/notes");

    if (isChapter) {
      const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      if (!sectionUrls.includes(fullUrl)) {
        sectionUrls.push(fullUrl);
      }
    } else if (isTitre && sectionUrls.length === 0) {
      // Fallback: if no chapter links found, use titre links
      const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
      if (!sectionUrls.includes(fullUrl)) {
        sectionUrls.push(fullUrl);
      }
    }
  });

  // If no structured links found, use the book page itself as the source
  if (sectionUrls.length === 0) {
    sectionUrls.push(bookUrl);
  }

  log(
    "INFO",
    `Book ${bookNum}: discovered ${sectionUrls.length} section pages`,
  );
  return sectionUrls;
}

interface ParsedArticle {
  reference: string;
  title: string;
  text: string;
  section: string;
}

/**
 * Parse articles from a chapter/section-level page.
 *
 * The AMF ELI pages render articles inline on chapter pages. Each article
 * appears as a heading (typically containing the article number) followed
 * by paragraph content. The heading contains a link with the article
 * number in its href (e.g. /article/311-1/...).
 */
function parseArticlesFromPage(html: string): ParsedArticle[] {
  const $ = cheerio.load(html);
  const articles: ParsedArticle[] = [];

  // Strategy 1: Find article links with ELI pattern
  // Article references appear in links like /article/311-1/DATE/notes
  const articlePattern = /\/article\/(\d+-\d+(?:-\d+)?)\//;

  // Collect all headings and text blocks
  // AMF renders articles with headings containing the article number link
  // followed by <p> tags with the article text.
  const headings = $("h1, h2, h3, h4, h5, h6, .article-title, [id*='article']");

  headings.each((_i, heading) => {
    const $heading = $(heading);
    const headingText = $heading.text().trim();

    // Check if this heading contains an article reference
    // Pattern: "Article 311-1" or link containing /article/311-1/
    let articleNum: string | null = null;

    // Check links within the heading
    const $link = $heading.find("a[href*='/article/']");
    if ($link.length > 0) {
      const href = $link.attr("href") ?? "";
      const match = articlePattern.exec(href);
      if (match?.[1]) {
        articleNum = match[1];
      }
    }

    // Fallback: match "Article NNN-N" in heading text
    if (!articleNum) {
      const textMatch = /Article\s+(\d+-\d+(?:-\d+)?)/i.exec(headingText);
      if (textMatch?.[1]) {
        articleNum = textMatch[1];
      }
    }

    if (!articleNum) return;

    // Extract title: heading text minus the "Article NNN-N" prefix
    const titleText = headingText
      .replace(/Article\s+\d+-\d+(?:-\d+)?/i, "")
      .replace(/^\s*[-–—:.\s]+/, "")
      .trim();

    // Extract body text: collect all following siblings until the next heading
    const bodyParts: string[] = [];
    let $next = $heading.next();
    while ($next.length > 0) {
      const tagName = ($next.prop("tagName") ?? "").toLowerCase();
      // Stop at the next heading
      if (/^h[1-6]$/.test(tagName)) break;
      // Stop if we hit another article marker
      if ($next.find("a[href*='/article/']").length > 0 && bodyParts.length > 0) break;

      const text = $next.text().trim();
      if (text.length > 0) {
        bodyParts.push(text);
      }
      $next = $next.next();
    }

    const bodyText = bodyParts.join("\n\n");
    if (bodyText.length === 0) return;

    // Derive section from article number: 311-1 → section 311
    const sectionNum = articleNum.split("-")[0] ?? "";

    articles.push({
      reference: `RG AMF Art. ${articleNum}`,
      title: titleText || `Article ${articleNum}`,
      text: bodyText,
      section: sectionNum,
    });
  });

  // Strategy 2: If headings didn't yield results, try parsing article blocks
  // by looking for anchor tags with ELI article hrefs
  if (articles.length === 0) {
    $("a[href*='/eli/fr/aai/amf/rg/article/']").each((_i, el) => {
      const $el = $(el);
      const href = $el.attr("href") ?? "";
      const match = articlePattern.exec(href);
      if (!match?.[1]) return;

      const articleNum = match[1];
      const ref = `RG AMF Art. ${articleNum}`;
      // Avoid duplicates
      if (articles.some((a) => a.reference === ref)) return;

      // Try to find the parent container and extract text from siblings
      const $parent = $el.closest(
        "div, section, article, li, td, .field, .article-wrapper",
      );
      if ($parent.length === 0) return;

      const parentText = $parent.text().trim();
      // Remove the article number prefix from the text
      const cleaned = parentText
        .replace(/Article\s+\d+-\d+(?:-\d+)?/gi, "")
        .replace(/^\s*[-–—:.\s]+/, "")
        .trim();

      if (cleaned.length < 20) return; // skip trivial/navigation-only matches

      const sectionNum = articleNum.split("-")[0] ?? "";
      articles.push({
        reference: ref,
        title: `Article ${articleNum}`,
        text: cleaned,
        section: sectionNum,
      });
    });
  }

  return articles;
}

async function crawlReglementGeneral(
  db: Database.Database,
  existingRefs: Set<string>,
): Promise<void> {
  log("INFO", "--- Crawling Règlement Général ---");

  const insertProvision = db.prepare(`
    INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  for (const book of RG_BOOKS) {
    log("INFO", `Processing Livre ${book.num}: ${book.name}`);
    const sectionUrls = await discoverBookSections(book.num);

    for (const url of sectionUrls) {
      log("INFO", `  Fetching: ${url}`);
      const html = await fetchWithRetry(url);
      if (!html) {
        stats.errors++;
        continue;
      }
      stats.pagesVisited++;

      const articles = parseArticlesFromPage(html);
      log("INFO", `  Parsed ${articles.length} articles from page`);

      for (const article of articles) {
        if (existingRefs.has(article.reference)) {
          stats.provisionsSkipped++;
          continue;
        }

        if (FLAG_DRY_RUN) {
          log(
            "INFO",
            `  [DRY RUN] Would insert: ${article.reference} — ${article.title.substring(0, 60)}`,
          );
          stats.provisionsInserted++;
          continue;
        }

        try {
          insertProvision.run(
            "AMF_Reglement_General",
            article.reference,
            article.title,
            article.text,
            "règle",
            "in_force",
            null, // effective_date filled per-article when available
            book.chapter,
            article.section,
          );
          stats.provisionsInserted++;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          log("ERROR", `  Failed to insert ${article.reference}: ${msg}`);
          stats.errors++;
        }
      }
    }

    log(
      "INFO",
      `Book ${book.num} complete. Running total: ${stats.provisionsInserted} inserted, ${stats.provisionsSkipped} skipped`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2. AMF Doctrine / Policy documents crawler
// ---------------------------------------------------------------------------

/**
 * AMF doctrine/policy documents are listed on the policy-content page:
 *   /en/regulation/policy/policy-content  (English index, with DOC references)
 *   /fr/reglementation/doctrine/doc-YYYY-NN  (individual French docs)
 *
 * Strategy: scrape the English index to collect DOC references, then
 * fetch each French document page for full text.
 */

interface DoctrineRef {
  docRef: string; // e.g. "DOC-2019-02"
  title: string;
  url: string;
}

async function discoverDoctrineRefs(): Promise<DoctrineRef[]> {
  const indexUrl = `${BASE_URL}/en/regulation/policy/policy-content`;
  const html = await fetchWithRetry(indexUrl);
  if (!html) return [];
  stats.pagesVisited++;

  const $ = cheerio.load(html);
  const refs: DoctrineRef[] = [];
  const seen = new Set<string>();

  // DOC references appear in links with pattern /regulation/policy/doc-YYYY-NN
  const docPattern = /\/(?:regulation\/policy|reglementation\/doctrine)\/(doc-\d{4}-\d{2,3})/i;

  $("a[href]").each((_i, el) => {
    const href = $(el).attr("href") ?? "";
    const match = docPattern.exec(href);
    if (!match?.[1]) return;

    const docId = match[1].toUpperCase(); // normalise to DOC-YYYY-NN
    if (seen.has(docId)) return;
    seen.add(docId);

    const linkText = $(el).text().trim();
    // Build the French URL for full-text retrieval
    const frUrl = `${BASE_URL}/fr/reglementation/doctrine/${docId.toLowerCase()}`;

    refs.push({
      docRef: docId,
      title: linkText || docId,
      url: frUrl,
    });
  });

  log("INFO", `Discovered ${refs.length} doctrine document references`);
  return refs;
}

interface ParsedDoctrineSection {
  reference: string;
  title: string;
  text: string;
  section: string;
}

/**
 * Extract article-level blocks from an HTML content region.
 *
 * Iterates through headings and paragraphs, splitting on
 * "Article N" headings and collecting body text for each.
 */
function extractArticleBlocks(
  $: cheerio.CheerioAPI,
  $content: ReturnType<typeof $>,
): Array<{ num: string; title: string; text: string }> {
  const blocks: Array<{ num: string; title: string; text: string }> = [];
  const elements = $content
    .find("h1, h2, h3, h4, h5, h6, p, li, div.field__item")
    .toArray();

  let currentNum: string | null = null;
  let currentTitle = "";
  let currentParts: string[] = [];

  for (const el of elements) {
    const $el = $(el);
    const tagName = ($el.prop("tagName") ?? "").toLowerCase();
    const text = $el.text().trim();
    if (!text) continue;

    // Check if this is an article heading
    const artMatch = /^(?:Article|Art\.?)\s+(\d+)/i.exec(text);
    if (artMatch && /^h[1-6]$/.test(tagName)) {
      // Save previous article
      if (currentNum !== null && currentParts.length > 0) {
        blocks.push({
          num: currentNum,
          title: currentTitle,
          text: currentParts.join("\n\n"),
        });
      }
      const artTitle = text
        .replace(/^(?:Article|Art\.?)\s+\d+\s*[-\u2013\u2014:.]?\s*/i, "")
        .trim();
      currentNum = artMatch[1] ?? "";
      currentTitle = artTitle;
      currentParts = [];
      continue;
    }

    if (currentNum !== null) {
      // Skip navigation-only text
      if (
        text.length > 15 &&
        !text.startsWith("Voir plus") &&
        !text.startsWith("Afficher")
      ) {
        currentParts.push(text);
      }
    }
  }

  // Save last article
  if (currentNum !== null && currentParts.length > 0) {
    blocks.push({
      num: currentNum,
      title: currentTitle,
      text: currentParts.join("\n\n"),
    });
  }

  return blocks;
}

/**
 * Parse the content of an individual doctrine document page.
 *
 * AMF doctrine pages are mostly navigation-heavy with the substantive text
 * in the main content area. We extract all meaningful paragraphs and
 * group them as a single provision per document, or split by numbered
 * articles if the document contains article-level structure.
 */
function parseDoctrineDocument(
  html: string,
  docRef: string,
  docTitle: string,
): ParsedDoctrineSection[] {
  const $ = cheerio.load(html);
  const sections: ParsedDoctrineSection[] = [];

  // Try to extract the main content area
  // AMF pages use various containers — try several selectors
  const contentSelectors = [
    "article .field--name-body",
    "article .node__content",
    ".layout-content .field--name-body",
    ".layout-content article",
    "main article",
    "main .content",
    "#block-amf-content",
  ];

  let $content: ReturnType<typeof $> | null = null;
  for (const sel of contentSelectors) {
    const $candidate = $(sel);
    if ($candidate.length > 0 && $candidate.text().trim().length > 100) {
      $content = $candidate;
      break;
    }
  }

  // Fallback: use the broadest content region
  if (!$content) {
    $content = $("main").length > 0 ? $("main") : $("body");
  }

  // Try to split by numbered articles within the document
  // Pattern: "Article 1", "Article 2", etc. or "Art. 1", "1."
  const articleBlocks: Array<{ num: string; title: string; text: string }> =
    extractArticleBlocks($, $content);


  if (articleBlocks.length > 0) {
    // We found structured articles — emit one provision per article
    for (const block of articleBlocks) {
      sections.push({
        reference: `${docRef} Art. ${block.num}`,
        title: block.title || `${docRef} Article ${block.num}`,
        text: block.text,
        section: block.num,
      });
    }
  } else {
    // No article structure found — emit the whole document as one provision
    // Collect all paragraph text from the content area, filtering navigation
    const paragraphs: string[] = [];
    $content.find("p, li").each((_i, el) => {
      const text = $(el).text().trim();
      if (
        text.length > 20 &&
        !text.startsWith("Voir plus") &&
        !text.startsWith("Afficher") &&
        !text.startsWith("Accueil") &&
        !text.includes("Rechercher")
      ) {
        paragraphs.push(text);
      }
    });

    const fullText = paragraphs.join("\n\n");
    if (fullText.length > 50) {
      sections.push({
        reference: docRef,
        title: docTitle,
        text: fullText,
        section: "1",
      });
    }
  }

  return sections;
}

/**
 * Determine the sourcebook_id and provision type based on the document
 * reference and title content.
 */
function classifyDoctrine(
  docRef: string,
  title: string,
): { sourcebookId: string; type: string } {
  const lowerTitle = (title + " " + docRef).toLowerCase();

  if (lowerTitle.includes("instruction")) {
    return { sourcebookId: "AMF_Instructions", type: "instruction" };
  }
  if (
    lowerTitle.includes("position") ||
    lowerTitle.includes("recommandation") ||
    lowerTitle.includes("recommendation")
  ) {
    return { sourcebookId: "AMF_Positions", type: "position-recommandation" };
  }
  // Default: general doctrine
  return { sourcebookId: "AMF_Doctrine", type: "doctrine" };
}

async function crawlDoctrine(
  db: Database.Database,
  existingRefs: Set<string>,
): Promise<void> {
  log("INFO", "--- Crawling AMF Doctrine ---");

  const insertProvision = db.prepare(`
    INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const docRefs = await discoverDoctrineRefs();

  for (const doc of docRefs) {
    // Check if this entire doc reference is already ingested
    if (existingRefs.has(doc.docRef)) {
      log("INFO", `  Skipping (already ingested): ${doc.docRef}`);
      stats.provisionsSkipped++;
      continue;
    }

    log("INFO", `  Fetching doctrine: ${doc.docRef} — ${doc.title.substring(0, 60)}`);
    const html = await fetchWithRetry(doc.url);
    if (!html) {
      stats.errors++;
      continue;
    }
    stats.pagesVisited++;

    const sections = parseDoctrineDocument(html, doc.docRef, doc.title);
    log("INFO", `  Parsed ${sections.length} sections from ${doc.docRef}`);

    const { sourcebookId, type } = classifyDoctrine(doc.docRef, doc.title);

    for (const section of sections) {
      if (existingRefs.has(section.reference)) {
        stats.provisionsSkipped++;
        continue;
      }

      if (FLAG_DRY_RUN) {
        log(
          "INFO",
          `  [DRY RUN] Would insert: ${section.reference} (${sourcebookId}) — ${section.title.substring(0, 50)}`,
        );
        stats.provisionsInserted++;
        continue;
      }

      try {
        insertProvision.run(
          sourcebookId,
          section.reference,
          section.title,
          section.text,
          type,
          "in_force",
          null,
          null,
          section.section,
        );
        stats.provisionsInserted++;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        log("ERROR", `  Failed to insert ${section.reference}: ${msg}`);
        stats.errors++;
      }
    }
  }
}

// ---------------------------------------------------------------------------
// 3. Enforcement decisions crawler
// ---------------------------------------------------------------------------

/**
 * AMF enforcement decisions are published as press releases at:
 *   /en/news-publications/news-releases/enforcement-committee-news-releases
 *
 * The decision listing page may load dynamically, so we also try the
 * dedicated decisions page at:
 *   /fr/sanction-transaction/Decisions-de-la-commission-des-sanctions
 *
 * Individual press releases follow the pattern:
 *   /en/news-publications/news-releases/enforcement-committee-news-releases/SLUG
 *
 * Each press release contains the firm name, fine amounts, and a summary
 * of the violation. Full decision PDFs are linked but not parsed.
 *
 * Strategy: scrape the press releases index (paginated with ?page=N),
 * then fetch each individual press release for structured data.
 */

interface EnforcementLink {
  url: string;
  title: string;
}

async function discoverEnforcementLinks(): Promise<EnforcementLink[]> {
  const links: EnforcementLink[] = [];
  const seen = new Set<string>();

  // Try both French and English listing pages, paginated
  const listingBases = [
    `${BASE_URL}/fr/actualites-publications/communiques/communiques-de-la-commission-des-sanctions`,
    `${BASE_URL}/en/news-publications/news-releases/enforcement-committee-news-releases`,
  ];

  for (const listingBase of listingBases) {
    // The sanctions listing pages may render dynamically, but the
    // enforcement-committee-news-releases pages serve static HTML with
    // links to individual press releases. Try up to 20 pages.
    for (let page = 0; page < 20; page++) {
      const url = page === 0 ? listingBase : `${listingBase}?page=${page}`;
      log("INFO", `  Fetching enforcement listing: page ${page}`);
      const html = await fetchWithRetry(url);
      if (!html) break;
      stats.pagesVisited++;

      const $ = cheerio.load(html);
      let foundOnPage = 0;

      // Find links to individual enforcement press releases
      $("a[href]").each((_i, el) => {
        const href = $(el).attr("href") ?? "";
        const text = $(el).text().trim();

        // Match enforcement committee news release URLs
        const isEnforcementRelease =
          (href.includes("/enforcement-committee-news-releases/") ||
            href.includes("/communiques-de-la-commission-des-sanctions/")) &&
          !href.endsWith("enforcement-committee-news-releases") &&
          !href.endsWith("communiques-de-la-commission-des-sanctions") &&
          text.length > 20;

        if (!isEnforcementRelease) return;

        const fullUrl = href.startsWith("http") ? href : `${BASE_URL}${href}`;
        if (seen.has(fullUrl)) return;
        seen.add(fullUrl);

        links.push({ url: fullUrl, title: text });
        foundOnPage++;
      });

      log("INFO", `  Page ${page}: found ${foundOnPage} enforcement links`);

      // If no links found on this page, stop paginating
      if (foundOnPage === 0) break;
    }
  }

  log("INFO", `Discovered ${links.length} enforcement press releases`);
  return links;
}

interface ParsedEnforcement {
  firmName: string;
  referenceNumber: string | null;
  actionType: string;
  amount: number | null;
  date: string | null;
  summary: string;
  sourcebookReferences: string | null;
}

/**
 * Parse an individual enforcement press release page.
 *
 * AMF press releases follow a consistent structure:
 *   <article class="node node--type-news-release">
 *     <h1> Title
 *     <p> Body paragraphs
 *   </article>
 *
 * The opening paragraph typically states:
 *   "In its decision of [DATE], the Enforcement Committee imposed a fine
 *    of [AMOUNT] on [FIRM] for [VIOLATIONS]..."
 *
 * Or in French:
 *   "Par décision du [DATE], la Commission des sanctions a prononcé une
 *    sanction pécuniaire de [MONTANT] à l'encontre de [SOCIÉTÉ]..."
 */
function parseEnforcementPage(html: string, pageUrl: string): ParsedEnforcement | null {
  const $ = cheerio.load(html);

  // Extract article content
  const $article = $("article").first();
  if ($article.length === 0) return null;

  const fullText = $article.text().trim();
  if (fullText.length < 100) return null;

  // Extract paragraphs for summary
  const paragraphs: string[] = [];
  $article.find("p").each((_i, el) => {
    const text = $(el).text().trim();
    if (text.length > 20) {
      paragraphs.push(text);
    }
  });

  const summary = paragraphs.slice(0, 5).join(" ").substring(0, 2000);
  if (summary.length < 50) return null;

  // Extract firm name from the title or first paragraph
  const title = $article.find("h1").first().text().trim() || $("title").text().trim();
  let firmName = extractFirmName(title, summary);
  if (!firmName) {
    firmName = "Unknown entity";
  }

  // Extract amounts (EUR)
  const amount = extractLargestAmount(fullText);

  // Extract date
  const date = extractDecisionDate(fullText);

  // Extract SAN reference (e.g. SAN-2026-01)
  const sanMatch = /SAN-\d{4}-\d{2,3}/i.exec(fullText);
  const referenceNumber = sanMatch ? sanMatch[0].toUpperCase() : null;

  // Classify action type
  const actionType = classifyEnforcementType(fullText);

  // Extract regulation references
  const sourcebookRefs = extractRegulationReferences(fullText);

  return {
    firmName,
    referenceNumber,
    actionType,
    amount,
    date,
    summary,
    sourcebookReferences: sourcebookRefs.length > 0 ? sourcebookRefs.join(", ") : null,
  };
}

function extractFirmName(title: string, summary: string): string | null {
  // English pattern: "fines [FIRM]" or "sanctions [FIRM]"
  const enPatterns = [
    /fines?\s+(?:an?\s+)?(.+?)\s+(?:and|for|a total|€|\$|EUR)/i,
    /sanctions?\s+(?:an?\s+)?(.+?)\s+(?:and|for|a total|€|\$|EUR)/i,
    /(?:imposed|pronounces?)\s+.*?\s+(?:on|against)\s+(.+?)\s+(?:for|and|a\s+(?:fine|total))/i,
  ];

  for (const pat of enPatterns) {
    const match = pat.exec(title);
    if (match?.[1]) {
      const name = match[1].trim().replace(/,?\s*$/, "");
      if (name.length > 2 && name.length < 100) return name;
    }
  }

  // French pattern: "à l'encontre de [FIRM]"
  const frPatterns = [
    /à\s+l['']encontre\s+d[eu']\s*(.+?)(?:\s+pour|\s+et\s+de|\s*,)/i,
    /sanctionn[ée]\s+(.+?)\s+(?:pour|et|d['']une)/i,
    /amende\s+.*?\s+(?:à|contre)\s+(.+?)(?:\s+pour|\s*,)/i,
  ];

  const textToSearch = title + " " + summary;
  for (const pat of frPatterns) {
    const match = pat.exec(textToSearch);
    if (match?.[1]) {
      const name = match[1].trim().replace(/,?\s*$/, "");
      if (name.length > 2 && name.length < 100) return name;
    }
  }

  return null;
}

function extractLargestAmount(text: string): number | null {
  // Match EUR amounts: €1,500,000 or 1 500 000 € or EUR 75,000,000
  // Also handles French notation: 1.500.000 or 1 500 000
  const amountPatterns = [
    /€\s*([\d.,\s]+)/g,
    /([\d.,\s]+)\s*€/g,
    /EUR\s*([\d.,\s]+)/g,
    /([\d.,\s]+)\s*EUR/g,
    /([\d.,\s]+)\s*euros?/gi,
  ];

  let maxAmount = 0;
  for (const pattern of amountPatterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const raw = match[1]?.trim();
      if (!raw) continue;

      // Normalise: remove spaces and handle comma/dot separators
      // French: 1.500.000 or 1 500 000
      // English: 1,500,000
      const cleaned = raw
        .replace(/\s/g, "")
        .replace(/\.(?=\d{3})/g, "") // remove dots used as thousands separator
        .replace(/,(?=\d{3})/g, ""); // remove commas used as thousands separator

      const value = parseFloat(cleaned);
      if (!isNaN(value) && value > maxAmount) {
        maxAmount = value;
      }
    }
  }

  return maxAmount > 0 ? maxAmount : null;
}

function extractDecisionDate(text: string): string | null {
  // English: "In its decision of 31 December 2025"
  // French: "Par décision du 15 mai 2024" or "en date du 15/05/2024"

  const monthMapEn: Record<string, string> = {
    january: "01", february: "02", march: "03", april: "04",
    may: "05", june: "06", july: "07", august: "08",
    september: "09", october: "10", november: "11", december: "12",
  };

  const monthMapFr: Record<string, string> = {
    janvier: "01", février: "02", mars: "03", avril: "04",
    mai: "05", juin: "06", juillet: "07", août: "08",
    septembre: "09", octobre: "10", novembre: "11", décembre: "12",
  };

  // English date: "decision of DD Month YYYY"
  const enMatch = /decision\s+of\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i.exec(text);
  if (enMatch) {
    const day = (enMatch[1] ?? "").padStart(2, "0");
    const month = monthMapEn[enMatch[2]?.toLowerCase() ?? ""];
    const year = enMatch[3];
    if (month && year) return `${year}-${month}-${day}`;
  }

  // French date: "décision du DD month YYYY"
  const frMatch = /d[ée]cision\s+du\s+(\d{1,2})\s+(\w+)\s+(\d{4})/i.exec(text);
  if (frMatch) {
    const day = (frMatch[1] ?? "").padStart(2, "0");
    const month = monthMapFr[frMatch[2]?.toLowerCase() ?? ""];
    const year = frMatch[3];
    if (month && year) return `${year}-${month}-${day}`;
  }

  // ISO-style date: DD/MM/YYYY
  const isoMatch = /(\d{2})\/(\d{2})\/(\d{4})/.exec(text);
  if (isoMatch) {
    return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1]}`;
  }

  return null;
}

function classifyEnforcementType(text: string): string {
  const lower = text.toLowerCase();

  if (lower.includes("amende") || lower.includes("fine") || lower.includes("pécuniaire")) {
    return "fine";
  }
  if (lower.includes("blâme") || lower.includes("reprimand")) {
    return "reprimand";
  }
  if (lower.includes("avertissement") || lower.includes("warning")) {
    return "warning";
  }
  if (lower.includes("interdiction") || lower.includes("ban") || lower.includes("prohibition")) {
    return "ban";
  }
  if (lower.includes("transaction") || lower.includes("settlement")) {
    return "settlement";
  }
  if (lower.includes("hors de cause") || lower.includes("clears") || lower.includes("acquitt")) {
    return "acquittal";
  }
  return "sanction";
}

function extractRegulationReferences(text: string): string[] {
  const refs: string[] = [];
  const seen = new Set<string>();

  // Match "RG AMF Art. NNN-N" or "Article NNN-N du règlement général"
  const patterns = [
    /(?:RG\s+AMF\s+)?Art(?:icle)?\.?\s+(\d{3}-\d+(?:-\d+)?)/gi,
    /article\s+(\d{3}-\d+(?:-\d+)?)\s+du\s+r[eè]glement\s+g[eé]n[eé]ral/gi,
    /articles?\s+L\.\s*(\d{3}-\d+(?:-\d+)?)\s+du\s+code/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const ref = `RG AMF Art. ${match[1]}`;
      if (!seen.has(ref)) {
        seen.add(ref);
        refs.push(ref);
      }
    }
  }

  return refs;
}

async function crawlEnforcement(
  db: Database.Database,
  existingEnfRefs: Set<string>,
): Promise<void> {
  log("INFO", "--- Crawling Enforcement Decisions ---");

  const insertEnforcement = db.prepare(`
    INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const enforcementLinks = await discoverEnforcementLinks();

  for (const link of enforcementLinks) {
    log(
      "INFO",
      `  Fetching enforcement: ${link.title.substring(0, 70)}`,
    );
    const html = await fetchWithRetry(link.url);
    if (!html) {
      stats.errors++;
      continue;
    }
    stats.pagesVisited++;

    const parsed = parseEnforcementPage(html, link.url);
    if (!parsed) {
      log("WARN", `  Could not parse enforcement data from: ${link.url}`);
      stats.errors++;
      continue;
    }

    // Check for resume skip
    if (parsed.referenceNumber && existingEnfRefs.has(parsed.referenceNumber)) {
      log("INFO", `  Skipping (already ingested): ${parsed.referenceNumber}`);
      stats.enforcementSkipped++;
      continue;
    }

    // Deduplicate by firm name + date when no reference number
    if (!parsed.referenceNumber) {
      const dedupeKey = `${parsed.firmName}::${parsed.date ?? ""}`;
      if (existingEnfRefs.has(dedupeKey)) {
        stats.enforcementSkipped++;
        continue;
      }
      existingEnfRefs.add(dedupeKey);
    }

    if (FLAG_DRY_RUN) {
      log(
        "INFO",
        `  [DRY RUN] Would insert enforcement: ${parsed.referenceNumber ?? "N/A"} — ${parsed.firmName} — ${parsed.amount ? `€${parsed.amount.toLocaleString()}` : "no amount"}`,
      );
      stats.enforcementInserted++;
      continue;
    }

    try {
      insertEnforcement.run(
        parsed.firmName,
        parsed.referenceNumber,
        parsed.actionType,
        parsed.amount,
        parsed.date,
        parsed.summary,
        parsed.sourcebookReferences,
      );
      stats.enforcementInserted++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log("ERROR", `  Failed to insert enforcement: ${msg}`);
      stats.errors++;
    }
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  log("INFO", "=== AMF/ACPR Ingestion Crawler ===");
  log("INFO", `Flags: resume=${FLAG_RESUME} dry-run=${FLAG_DRY_RUN} force=${FLAG_FORCE}`);
  log("INFO", `Database: ${DB_PATH}`);
  log("INFO", `Rate limit: ${RATE_LIMIT_MS}ms between requests`);

  const db = FLAG_DRY_RUN ? null : initDb();

  if (db) {
    ensureSourcebooks(db);
  } else {
    log("INFO", "[DRY RUN] Skipping database initialisation");
  }

  // For dry-run mode, create an in-memory DB just for resume tracking queries
  const queryDb = db ?? (() => {
    const memDb = new Database(":memory:");
    memDb.exec(SCHEMA_SQL);
    return memDb;
  })();

  const existingRefs = getExistingReferences(queryDb);
  const existingEnfRefs = getExistingEnforcementRefs(queryDb);

  const startTime = Date.now();

  // Phase 1: Règlement Général
  await crawlReglementGeneral(queryDb, existingRefs);

  // Phase 2: AMF Doctrine / Policy documents
  await crawlDoctrine(queryDb, existingRefs);

  // Phase 3: Enforcement decisions
  await crawlEnforcement(queryDb, existingEnfRefs);

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  log("INFO", "");
  log("INFO", "=== Crawl Summary ===");
  log("INFO", `Duration:               ${elapsed}s`);
  log("INFO", `Pages visited:          ${stats.pagesVisited}`);
  log("INFO", `Provisions inserted:    ${stats.provisionsInserted}`);
  log("INFO", `Provisions skipped:     ${stats.provisionsSkipped}`);
  log("INFO", `Enforcement inserted:   ${stats.enforcementInserted}`);
  log("INFO", `Enforcement skipped:    ${stats.enforcementSkipped}`);
  log("INFO", `Errors:                 ${stats.errors}`);
  if (FLAG_DRY_RUN) {
    log("INFO", "(Dry-run mode — nothing written to database)");
  }

  if (db) {
    // Final DB counts
    const provCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions").get() as { cnt: number }
    ).cnt;
    const sbCount = (
      db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as { cnt: number }
    ).cnt;
    const enfCount = (
      db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as {
        cnt: number;
      }
    ).cnt;
    const ftsCount = (
      db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as {
        cnt: number;
      }
    ).cnt;

    log("INFO", "");
    log("INFO", "=== Database Totals ===");
    log("INFO", `Sourcebooks:            ${sbCount}`);
    log("INFO", `Provisions:             ${provCount}`);
    log("INFO", `Enforcement actions:    ${enfCount}`);
    log("INFO", `FTS entries:            ${ftsCount}`);

    db.close();
  }

  if (!db && queryDb) {
    queryDb.close();
  }

  log("INFO", `\nDone. Database: ${DB_PATH}`);
}

main().catch((err: unknown) => {
  log("ERROR", `Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
