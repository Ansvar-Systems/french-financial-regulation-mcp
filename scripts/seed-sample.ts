/**
 * Seed the AMF/ACPR French financial regulation database with sample provisions for testing.
 *
 * Inserts representative provisions from:
 *   - AMF Règlement Général (livres I-VI)
 *   - AMF Position-Recommandation DOC-2019-02 (cybersécurité)
 *   - AMF Doctrine (abus de marché)
 *   - ACPR Instruction 2022-I-01 (résilience opérationnelle)
 *   - ACPR Recommandation (externalisation)
 *
 * Usage:
 *   npx tsx scripts/seed-sample.ts
 *   npx tsx scripts/seed-sample.ts --force   # drop and recreate
 */

import Database from "better-sqlite3";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { SCHEMA_SQL } from "../src/db.js";

const DB_PATH = process.env["AMF_DB_PATH"] ?? "data/amf.db";
const force = process.argv.includes("--force");

// Bootstrap database ----------------------------------------------------------

const dir = dirname(DB_PATH);
if (!existsSync(dir)) {
  mkdirSync(dir, { recursive: true });
}

if (force && existsSync(DB_PATH)) {
  unlinkSync(DB_PATH);
  console.log(`Base de données supprimée : ${DB_PATH}`);
}

const db = new Database(DB_PATH);
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(SCHEMA_SQL);

console.log(`Base de données initialisée : ${DB_PATH}`);

// Sourcebooks -----------------------------------------------------------------

interface SourcebookRow {
  id: string;
  name: string;
  description: string;
}

const sourcebooks: SourcebookRow[] = [
  {
    id: "AMF_Reglement_General",
    name: "Règlement Général de l'AMF",
    description:
      "Règlement général de l'Autorité des marchés financiers couvrant la prestation de services d'investissement, les infrastructures de marché, la gestion collective, l'information financière et les offres au public (livres I à VI).",
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

const insertSourcebook = db.prepare(
  "INSERT OR IGNORE INTO sourcebooks (id, name, description) VALUES (?, ?, ?)",
);

for (const sb of sourcebooks) {
  insertSourcebook.run(sb.id, sb.name, sb.description);
}

console.log(`${sourcebooks.length} recueils insérés`);

// Sample provisions -----------------------------------------------------------

interface ProvisionRow {
  sourcebook_id: string;
  reference: string;
  title: string;
  text: string;
  type: string;
  status: string;
  effective_date: string;
  chapter: string;
  section: string;
}

const provisions: ProvisionRow[] = [
  // AMF Reglement General — Livre I : L'Autorité des marchés financiers
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 311-1",
    title: "Agrément des prestataires de services d'investissement",
    text: "Les prestataires de services d'investissement doivent être agréés par l'Autorité des marchés financiers pour exercer les services d'investissement mentionnés à l'article L. 321-1 du code monétaire et financier. L'agrément précise les services d'investissement et les services connexes que le prestataire est autorisé à fournir.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "311",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 313-1",
    title: "Organisation interne — principes généraux",
    text: "Les prestataires de services d'investissement mettent en place des politiques, procédures et dispositions organisationnelles permettant de garantir qu'ils et leurs personnels concernés respectent les obligations résultant du présent règlement général. Ces politiques et procédures doivent être proportionnées à la nature, à l'échelle et à la complexité de leur activité.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "313",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 313-2",
    title: "Responsabilité des dirigeants",
    text: "Les prestataires de services d'investissement s'assurent que leurs dirigeants sont responsables de l'application des politiques et procédures définies à l'article 313-1 du présent règlement général. Ils veillent à ce que les personnes qui participent à la réalisation de services d'investissement soient clairement informées de leurs responsabilités.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "313",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 314-1",
    title: "Primauté de l'intérêt du client",
    text: "Les prestataires de services d'investissement agissent d'une manière honnête, loyale et professionnelle qui sert au mieux l'intérêt de leurs clients, y compris pour les services d'investissement qu'ils proposent sur leurs propres instruments financiers ou sur des instruments financiers émis par des entités ayant des liens étroits avec eux.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "314",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 314-3",
    title: "Communication claire, exacte et non trompeuse",
    text: "Les informations, y compris les communications à caractère promotionnel, adressées par les prestataires de services d'investissement à leurs clients ou clients potentiels, présentent un contenu exact, clair et non trompeur. Les communications à caractère promotionnel sont clairement identifiables en tant que telles.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "314",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 314-18",
    title: "Gestion des conflits d'intérêts",
    text: "Les prestataires de services d'investissement maintiennent et appliquent des dispositions organisationnelles et administratives efficaces en vue de prendre toutes les mesures raisonnables destinées à empêcher les conflits d'intérêts de porter atteinte aux intérêts de leurs clients. Ces dispositions sont proportionnées à la nature, à l'échelle et à la complexité de l'activité du prestataire.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "314",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 314-44",
    title: "Évaluation de l'adéquation",
    text: "Avant de fournir des services de conseil en investissement ou de gestion de portefeuille pour le compte de tiers, les prestataires de services d'investissement obtiennent auprès de leurs clients ou clients potentiels les informations nécessaires concernant leurs connaissances et leur expérience en matière d'investissement pour le type spécifique de produit ou de service, leur situation financière, notamment leur capacité à subir des pertes, et leurs objectifs d'investissement, notamment leur tolérance aux risques.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "314",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 316-1",
    title: "Meilleure exécution",
    text: "Lorsqu'ils exécutent des ordres pour le compte de clients, les prestataires de services d'investissement prennent toutes les mesures suffisantes pour obtenir le meilleur résultat possible pour leurs clients, compte tenu du prix, du coût, de la rapidité, de la probabilité d'exécution et du règlement, de la taille et de la nature de l'ordre ou de tout autre élément relatif à l'exécution de l'ordre.",
    type: "règle",
    status: "in_force",
    effective_date: "2007-11-01",
    chapter: "I",
    section: "316",
  },
  // AMF Reglement General — Livre VI : Manquements et sanctions
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 621-1",
    title: "Définition de l'information privilégiée",
    text: "Une information privilégiée est une information précise qui n'a pas été rendue publique, qui concerne, directement ou indirectement, un ou plusieurs émetteurs, ou un ou plusieurs instruments financiers, et qui, si elle était rendue publique, serait susceptible d'influencer de façon sensible le cours des instruments financiers concernés ou le cours d'instruments financiers dérivés qui leur sont liés.",
    type: "règle",
    status: "in_force",
    effective_date: "2016-07-03",
    chapter: "VI",
    section: "621",
  },
  {
    sourcebook_id: "AMF_Reglement_General",
    reference: "RG AMF Art. 622-1",
    title: "Interdiction d'initié",
    text: "Il est interdit à toute personne détenant une information privilégiée d'utiliser cette information en acquérant ou en cédant, ou en tentant d'acquérir ou de céder, pour son propre compte ou pour le compte d'un tiers, directement ou indirectement, les instruments financiers auxquels se rapporte cette information ou les instruments financiers auxquels ces instruments sont liés.",
    type: "règle",
    status: "in_force",
    effective_date: "2016-07-03",
    chapter: "VI",
    section: "622",
  },

  // AMF Positions-Recommandations — DOC-2019-02 Cybersécurité
  {
    sourcebook_id: "AMF_Positions",
    reference: "DOC-2019-02 Art. 1",
    title: "Champ d'application — cybersécurité des systèmes d'information",
    text: "La présente position-recommandation s'applique à l'ensemble des prestataires de services d'investissement agréés en France. Elle précise les attentes de l'AMF en matière de sécurité des systèmes d'information utilisés dans le cadre des services d'investissement, notamment la gestion des risques cyber, la continuité des opérations en cas de cyberattaque et la déclaration des incidents significatifs.",
    type: "position-recommandation",
    status: "in_force",
    effective_date: "2019-06-01",
    chapter: "I",
    section: "1",
  },
  {
    sourcebook_id: "AMF_Positions",
    reference: "DOC-2019-02 Art. 3",
    title: "Gouvernance de la cybersécurité",
    text: "Les prestataires de services d'investissement doivent mettre en place une gouvernance de la cybersécurité adaptée à leur taille et à la nature de leurs activités. Le conseil d'administration ou l'organe de surveillance équivalent doit être régulièrement informé des risques cyber auxquels l'établissement est exposé et des mesures prises pour les atténuer. Un responsable de la sécurité des systèmes d'information (RSSI) doit être désigné avec des responsabilités clairement définies.",
    type: "position-recommandation",
    status: "in_force",
    effective_date: "2019-06-01",
    chapter: "I",
    section: "3",
  },
  {
    sourcebook_id: "AMF_Positions",
    reference: "DOC-2019-02 Art. 5",
    title: "Gestion des incidents cyber",
    text: "Les prestataires de services d'investissement doivent disposer d'une procédure de gestion des incidents de cybersécurité permettant leur détection rapide, leur qualification et leur traitement. Tout incident cyber susceptible d'avoir un impact significatif sur la continuité des services d'investissement ou sur la protection des données des clients doit être déclaré à l'AMF dans les meilleurs délais et, au plus tard, dans les 24 heures suivant sa détection.",
    type: "position-recommandation",
    status: "in_force",
    effective_date: "2019-06-01",
    chapter: "I",
    section: "5",
  },

  // AMF Doctrine — Abus de marché
  {
    sourcebook_id: "AMF_Doctrine",
    reference: "AMF-DOC-MAR-2016-01 Art. 2",
    title: "Manipulation de cours — définition et exemples",
    text: "Constitue une manipulation de cours le fait d'effectuer des transactions ou d'émettre des ordres qui donnent ou sont susceptibles de donner des indications fausses ou trompeuses en ce qui concerne l'offre, la demande ou le cours d'un instrument financier ou qui fixent, par l'action d'une ou de plusieurs personnes agissant de manière concertée, le cours d'un ou de plusieurs instruments financiers à un niveau anormal ou artificiel.",
    type: "doctrine",
    status: "in_force",
    effective_date: "2016-07-03",
    chapter: "I",
    section: "2",
  },
  {
    sourcebook_id: "AMF_Doctrine",
    reference: "AMF-DOC-MAR-2016-01 Art. 4",
    title: "Obligations de surveillance des transactions",
    text: "Les prestataires de services d'investissement mettent en oeuvre des systèmes et des procédures efficaces pour détecter et signaler les transactions et ordres qui pourraient constituer des opérations d'initiés, des manipulations de marché ou des tentatives d'abus de marché. Ils désignent un responsable chargé de la surveillance des transactions et communiquent à l'AMF les déclarations d'opérations suspectes (DOS) sans délai.",
    type: "doctrine",
    status: "in_force",
    effective_date: "2016-07-03",
    chapter: "I",
    section: "4",
  },

  // ACPR Instructions — 2022-I-01 Résilience opérationnelle
  {
    sourcebook_id: "ACPR_Instructions",
    reference: "ACPR 2022-I-01 Art. 1",
    title: "Champ d'application — résilience opérationnelle",
    text: "La présente instruction précise les modalités d'application des exigences de résilience opérationnelle applicables aux établissements de crédit, aux entreprises d'investissement et aux organismes d'assurance soumis au contrôle de l'ACPR. Elle couvre l'identification des fonctions critiques ou importantes, la gestion des risques liés aux prestataires de services tiers essentiels et les tests de résilience opérationnelle.",
    type: "instruction",
    status: "in_force",
    effective_date: "2022-01-17",
    chapter: "I",
    section: "1",
  },
  {
    sourcebook_id: "ACPR_Instructions",
    reference: "ACPR 2022-I-01 Art. 5",
    title: "Identification des fonctions critiques ou importantes",
    text: "Les entités assujetties procèdent à une identification et à une classification de leurs fonctions et activités selon leur caractère critique ou important. Sont considérées comme critiques ou importantes les fonctions dont l'interruption est susceptible de nuire gravement à la continuité des services fournis aux clients, à l'intégrité du marché ou à la stabilité financière. La liste des fonctions critiques ou importantes est documentée et revue au minimum annuellement.",
    type: "instruction",
    status: "in_force",
    effective_date: "2022-01-17",
    chapter: "I",
    section: "5",
  },
  {
    sourcebook_id: "ACPR_Instructions",
    reference: "ACPR 2022-I-01 Art. 8",
    title: "Tests de résilience opérationnelle",
    text: "Les entités assujetties réalisent des tests de résilience opérationnelle portant sur leurs fonctions critiques ou importantes. Ces tests comprennent des scénarios de perturbation opérationnelle grave, notamment des incidents de cybersécurité, des défaillances de prestataires tiers essentiels et des catastrophes naturelles. Les résultats des tests et les plans de remédiation identifiés sont communiqués à l'organe de direction et à l'ACPR sur demande.",
    type: "instruction",
    status: "in_force",
    effective_date: "2022-01-17",
    chapter: "I",
    section: "8",
  },

  // ACPR Recommandations — Externalisation
  {
    sourcebook_id: "ACPR_Recommandations",
    reference: "ACPR-REC-EXT-2021 Art. 1",
    title: "Externalisation — principes généraux",
    text: "Les entités soumises au contrôle de l'ACPR qui externalisent des fonctions ou des activités opérationnelles importantes conservent l'entière responsabilité du respect de leurs obligations réglementaires. Elles mettent en oeuvre une politique d'externalisation documentée définissant les critères de sélection des prestataires, les modalités de suivi des prestations externalisées et les mesures de continuité en cas de défaillance du prestataire.",
    type: "recommandation",
    status: "in_force",
    effective_date: "2021-03-01",
    chapter: "I",
    section: "1",
  },
  {
    sourcebook_id: "ACPR_Recommandations",
    reference: "ACPR-REC-EXT-2021 Art. 4",
    title: "Concentration du risque prestataire",
    text: "Les entités assujetties évaluent et surveillent le risque de concentration lié à l'utilisation d'un nombre limité de prestataires pour les fonctions critiques ou importantes. Lorsqu'une dépendance significative à l'égard d'un prestataire unique est identifiée, des plans d'urgence et de substitution sont élaborés et testés régulièrement. L'ACPR peut demander communication de l'analyse de concentration effectuée par l'entité.",
    type: "recommandation",
    status: "in_force",
    effective_date: "2021-03-01",
    chapter: "I",
    section: "4",
  },
  {
    sourcebook_id: "ACPR_Recommandations",
    reference: "ACPR-REC-EXT-2021 Art. 6",
    title: "Externalisation vers des prestataires cloud",
    text: "Les entités assujetties qui externalisent des fonctions ou des activités vers des prestataires de services en nuage (cloud) veillent à ce que les contrats conclus avec ces prestataires garantissent les droits d'audit de l'ACPR, la portabilité des données et la réversibilité des services. Un plan de sortie documenté doit être établi dès la conclusion du contrat d'externalisation cloud.",
    type: "recommandation",
    status: "in_force",
    effective_date: "2021-03-01",
    chapter: "I",
    section: "6",
  },
];

const insertProvision = db.prepare(`
  INSERT INTO provisions (sourcebook_id, reference, title, text, type, status, effective_date, chapter, section)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const insertAll = db.transaction(() => {
  for (const p of provisions) {
    insertProvision.run(
      p.sourcebook_id,
      p.reference,
      p.title,
      p.text,
      p.type,
      p.status,
      p.effective_date,
      p.chapter,
      p.section,
    );
  }
});

insertAll();

console.log(`${provisions.length} dispositions insérées`);

// Sample enforcement actions --------------------------------------------------

interface EnforcementRow {
  firm_name: string;
  reference_number: string;
  action_type: string;
  amount: number;
  date: string;
  summary: string;
  sourcebook_references: string;
}

const enforcements: EnforcementRow[] = [
  {
    firm_name: "Société Générale",
    reference_number: "AMF-SAN-2008-18",
    action_type: "fine",
    amount: 4_000_000,
    date: "2008-07-04",
    summary:
      "Sanction prononcée à l'encontre de Société Générale dans le contexte de l'affaire Kerviel. La Commission des sanctions de l'AMF a retenu un manquement aux obligations de contrôle interne et à la surveillance des opérations des traders. La banque n'avait pas mis en place des systèmes de contrôle interne suffisants pour détecter les positions hors normes accumulées par un trader depuis 2006.",
    sourcebook_references: "RG AMF Art. 313-1, RG AMF Art. 313-2",
  },
  {
    firm_name: "Natixis Asset Management",
    reference_number: "AMF-SAN-2014-07",
    action_type: "fine",
    amount: 1_500_000,
    date: "2014-06-26",
    summary:
      "Sanction prononcée à l'encontre de Natixis Asset Management pour manquements à ses obligations professionnelles en matière de gestion pour le compte de tiers. La Commission des sanctions a relevé des insuffisances dans la gestion des conflits d'intérêts, notamment lors de transactions entre les fonds gérés et des entités du groupe, ainsi que des carences dans l'information des porteurs de parts.",
    sourcebook_references: "RG AMF Art. 314-18, RG AMF Art. 314-1",
  },
  {
    firm_name: "H2O Asset Management",
    reference_number: "AMF-SAN-2022-05",
    action_type: "fine",
    amount: 75_000_000,
    date: "2022-11-30",
    summary:
      "Sanction record prononcée à l'encontre de H2O Asset Management LLP et de plusieurs de ses dirigeants pour de nombreux manquements liés à la gestion et à la valorisation des actifs illiquides dans ses fonds obligataires. La Commission des sanctions a retenu des manquements aux règles d'évaluation des actifs, à l'obligation d'agir dans l'intérêt des porteurs de parts, au dispositif de gestion des conflits d'intérêts et aux obligations de déclaration à l'AMF. Les manquements ont exposé des milliers d'investisseurs particuliers à des pertes significatives.",
    sourcebook_references: "RG AMF Art. 314-1, RG AMF Art. 314-18, RG AMF Art. 314-3",
  },
];

const insertEnforcement = db.prepare(`
  INSERT INTO enforcement_actions (firm_name, reference_number, action_type, amount, date, summary, sourcebook_references)
  VALUES (?, ?, ?, ?, ?, ?, ?)
`);

const insertEnforcementsAll = db.transaction(() => {
  for (const e of enforcements) {
    insertEnforcement.run(
      e.firm_name,
      e.reference_number,
      e.action_type,
      e.amount,
      e.date,
      e.summary,
      e.sourcebook_references,
    );
  }
});

insertEnforcementsAll();

console.log(`${enforcements.length} décisions de sanction insérées`);

// Summary ---------------------------------------------------------------------

const provisionCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions").get() as {
    cnt: number;
  }
).cnt;
const sourcebookCount = (
  db.prepare("SELECT count(*) as cnt FROM sourcebooks").get() as {
    cnt: number;
  }
).cnt;
const enforcementCount = (
  db.prepare("SELECT count(*) as cnt FROM enforcement_actions").get() as {
    cnt: number;
  }
).cnt;
const ftsCount = (
  db.prepare("SELECT count(*) as cnt FROM provisions_fts").get() as {
    cnt: number;
  }
).cnt;

console.log(`\nRécapitulatif de la base de données :`);
console.log(`  Recueils :              ${sourcebookCount}`);
console.log(`  Dispositions :          ${provisionCount}`);
console.log(`  Décisions de sanction : ${enforcementCount}`);
console.log(`  Entrées FTS :           ${ftsCount}`);
console.log(`\nTerminé. Base de données prête : ${DB_PATH}`);

db.close();
