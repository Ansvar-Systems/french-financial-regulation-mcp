#!/usr/bin/env node

/**
 * HTTP Server Entry Point for Docker Deployment
 *
 * Provides Streamable HTTP transport for remote MCP clients.
 * Use src/index.ts for local stdio-based usage.
 *
 * Endpoints:
 *   GET  /health  — liveness probe
 *   POST /mcp     — MCP Streamable HTTP (session-aware)
 */

import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
  getDataFreshness,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PORT = parseInt(process.env["PORT"] ?? "3000", 10);
const SERVER_NAME = "french-financial-regulation-mcp";

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback
}

// --- Metadata block (included in every tool response) ------------------------

const META = {
  disclaimer:
    "Ce serveur MCP fournit des données à titre informatif uniquement. Vérifiez toujours les sources officielles AMF et ACPR avant de prendre des décisions réglementaires. This tool is not legal or regulatory advice.",
  data_age:
    "Les données sont mises à jour périodiquement depuis les publications officielles AMF/ACPR. Data may lag official publications.",
  copyright:
    "Données issues des publications officielles de l'AMF et de l'ACPR. Domaine public français.",
  source_url: "https://www.amf-france.org / https://acpr.banque-france.fr",
} as const;

// --- Tool definitions (shared with index.ts) ---------------------------------

const TOOLS = [
  {
    name: "fr_fin_search_regulations",
    description:
      "Recherche plein texte dans les dispositions AMF et ACPR. Retourne les règles, positions, recommandations et instructions correspondantes.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Requête de recherche en français" },
        sourcebook: { type: "string", description: "Filtrer par identifiant de recueil (ex. AMF_Reglement_General). Optionnel." },
        status: {
          type: "string",
          enum: ["in_force", "deleted", "not_yet_in_force"],
          description: "Filtrer par statut. Optionnel.",
        },
        limit: { type: "number", description: "Nombre max de résultats (défaut 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "fr_fin_get_regulation",
    description:
      "Récupère une disposition AMF ou ACPR spécifique par recueil et référence (ex. RG AMF Art. 314-1).",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourcebook: { type: "string", description: "Identifiant du recueil (ex. AMF_Reglement_General, ACPR_Instructions)" },
        reference: { type: "string", description: "Référence de la disposition (ex. RG AMF Art. 314-1)" },
      },
      required: ["sourcebook", "reference"],
    },
  },
  {
    name: "fr_fin_list_sourcebooks",
    description: "Liste tous les recueils AMF et ACPR avec noms et descriptions.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "fr_fin_search_enforcement",
    description:
      "Recherche les décisions de sanction AMF et ACPR — amendes, interdictions, avertissements et restrictions.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "Requête (nom de l'établissement, type de manquement, etc.)" },
        action_type: {
          type: "string",
          enum: ["fine", "ban", "restriction", "warning"],
          description: "Filtrer par type de sanction. Optionnel.",
        },
        limit: { type: "number", description: "Nombre max de résultats (défaut 20)." },
      },
      required: ["query"],
    },
  },
  {
    name: "fr_fin_check_currency",
    description: "Vérifie si une référence de disposition AMF ou ACPR est actuellement en vigueur.",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: { type: "string", description: "Référence de la disposition (ex. RG AMF Art. 314-1)" },
      },
      required: ["reference"],
    },
  },
  {
    name: "fr_fin_about",
    description: "Retourne les métadonnées de ce serveur MCP : version, sources des données, liste des outils.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "fr_fin_check_data_freshness",
    description:
      "Retourne le nombre de dispositions et de décisions de sanction dans la base de données, ainsi que la date de la dernière décision indexée.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
  {
    name: "fr_fin_list_sources",
    description:
      "Retourne les URLs officielles des sources de données AMF et ACPR utilisées par ce serveur.",
    inputSchema: { type: "object" as const, properties: {}, required: [] },
  },
];

// --- Zod schemas -------------------------------------------------------------

const SearchRegulationsArgs = z.object({
  query: z.string().min(1),
  sourcebook: z.string().optional(),
  status: z.enum(["in_force", "deleted", "not_yet_in_force"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const GetRegulationArgs = z.object({
  sourcebook: z.string().min(1),
  reference: z.string().min(1),
});

const SearchEnforcementArgs = z.object({
  query: z.string().min(1),
  action_type: z.enum(["fine", "ban", "restriction", "warning"]).optional(),
  limit: z.number().int().positive().max(100).optional(),
});

const CheckCurrencyArgs = z.object({
  reference: z.string().min(1),
});

// --- MCP server factory ------------------------------------------------------

function createMcpServer(): Server {
  const server = new Server(
    { name: SERVER_NAME, version: pkgVersion },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS,
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args = {} } = request.params;

    function textContent(data: unknown) {
      return {
        content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
      };
    }

    function errorContent(message: string) {
      return {
        content: [{ type: "text" as const, text: message }],
        isError: true as const,
      };
    }

    function withMeta<T extends object>(data: T): T & { _meta: typeof META } {
      return { ...data, _meta: META };
    }

    try {
      switch (name) {
        case "fr_fin_search_regulations": {
          const parsed = SearchRegulationsArgs.parse(args);
          const results = searchProvisions({
            query: parsed.query,
            sourcebook: parsed.sourcebook,
            status: parsed.status,
            limit: parsed.limit,
          });
          return textContent(withMeta({ results, count: results.length }));
        }

        case "fr_fin_get_regulation": {
          const parsed = GetRegulationArgs.parse(args);
          const provision = getProvision(parsed.sourcebook, parsed.reference);
          if (!provision) {
            return errorContent(
              `Disposition introuvable : ${parsed.sourcebook} ${parsed.reference}`,
            );
          }
          const provisionRecord = provision as unknown as Record<string, unknown>;
          return textContent(withMeta({
            ...provisionRecord,
            _citation: buildCitation(
              String(provisionRecord.reference ?? parsed.reference),
              String(provisionRecord.title ?? `${parsed.sourcebook} ${parsed.reference}`),
              "fr_fin_get_regulation",
              { sourcebook: parsed.sourcebook, reference: parsed.reference },
              provisionRecord.url as string | undefined,
            ),
          }));
        }

        case "fr_fin_list_sourcebooks": {
          const sourcebooks = listSourcebooks();
          return textContent(withMeta({ sourcebooks, count: sourcebooks.length }));
        }

        case "fr_fin_search_enforcement": {
          const parsed = SearchEnforcementArgs.parse(args);
          const results = searchEnforcement({
            query: parsed.query,
            action_type: parsed.action_type,
            limit: parsed.limit,
          });
          return textContent(withMeta({ results, count: results.length }));
        }

        case "fr_fin_check_currency": {
          const parsed = CheckCurrencyArgs.parse(args);
          const currency = checkProvisionCurrency(parsed.reference);
          return textContent(withMeta(currency));
        }

        case "fr_fin_about": {
          return textContent(withMeta({
            name: SERVER_NAME,
            version: pkgVersion,
            description:
              "Serveur MCP pour la réglementation financière française — AMF et ACPR. Donne accès au Règlement Général AMF, aux positions-recommandations, à la doctrine, aux instructions ACPR et aux décisions de sanction.",
            data_sources: [
              "AMF Règlement Général (https://www.amf-france.org/fr/reglementation/reglement-general)",
              "AMF Positions-Recommandations (https://www.amf-france.org/fr/reglementation/doctrine)",
              "ACPR Instructions (https://acpr.banque-france.fr/reglementation/instructions)",
              "ACPR Recommandations (https://acpr.banque-france.fr/reglementation/recommandations)",
            ],
            tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
          }));
        }

        case "fr_fin_check_data_freshness": {
          const freshness = getDataFreshness();
          return textContent(withMeta(freshness));
        }

        case "fr_fin_list_sources": {
          return textContent(withMeta({
            sources: [
              {
                name: "AMF Règlement Général",
                authority: "Autorité des marchés financiers",
                url: "https://www.amf-france.org/fr/reglementation/reglement-general",
                sourcebook_id: "AMF_Reglement_General",
              },
              {
                name: "AMF Positions-Recommandations",
                authority: "Autorité des marchés financiers",
                url: "https://www.amf-france.org/fr/reglementation/doctrine",
                sourcebook_id: "AMF_Positions",
              },
              {
                name: "AMF Doctrine",
                authority: "Autorité des marchés financiers",
                url: "https://www.amf-france.org/fr/reglementation/doctrine",
                sourcebook_id: "AMF_Doctrine",
              },
              {
                name: "ACPR Instructions",
                authority: "Autorité de contrôle prudentiel et de résolution",
                url: "https://acpr.banque-france.fr/reglementation/instructions",
                sourcebook_id: "ACPR_Instructions",
              },
              {
                name: "ACPR Recommandations",
                authority: "Autorité de contrôle prudentiel et de résolution",
                url: "https://acpr.banque-france.fr/reglementation/recommandations",
                sourcebook_id: "ACPR_Recommandations",
              },
            ],
          }));
        }

        default:
          return errorContent(`Outil inconnu : ${name}`);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorContent(`Erreur lors de l'exécution de ${name} : ${message}`);
    }
  });

  return server;
}

// --- HTTP server -------------------------------------------------------------

async function main(): Promise<void> {
  const sessions = new Map<
    string,
    { transport: StreamableHTTPServerTransport; server: Server }
  >();

  const httpServer = createServer((req, res) => {
    handleRequest(req, res, sessions).catch((err) => {
      console.error(`[${SERVER_NAME}] Unhandled error:`, err);
      if (!res.headersSent) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Internal server error" }));
      }
    });
  });

  async function handleRequest(
    req: import("node:http").IncomingMessage,
    res: import("node:http").ServerResponse,
    activeSessions: Map<
      string,
      { transport: StreamableHTTPServerTransport; server: Server }
    >,
  ): Promise<void> {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);

    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", server: SERVER_NAME, version: pkgVersion }));
      return;
    }

    if (url.pathname === "/mcp") {
      const sessionId = req.headers["mcp-session-id"] as string | undefined;

      if (sessionId && activeSessions.has(sessionId)) {
        const session = activeSessions.get(sessionId)!;
        await session.transport.handleRequest(req, res);
        return;
      }

      // New session — create a fresh MCP server instance per session
      const mcpServer = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
      });

      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- SDK type mismatch with exactOptionalPropertyTypes
      await mcpServer.connect(transport as any);

      transport.onclose = () => {
        if (transport.sessionId) {
          activeSessions.delete(transport.sessionId);
        }
        mcpServer.close().catch(() => {});
      };

      await transport.handleRequest(req, res);

      // Store AFTER handleRequest — sessionId is set during initialize
      if (transport.sessionId) {
        activeSessions.set(transport.sessionId, { transport, server: mcpServer });
      }
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  httpServer.listen(PORT, () => {
    console.error(`${SERVER_NAME} v${pkgVersion} (HTTP) listening on port ${PORT}`);
    console.error(`MCP endpoint:  http://localhost:${PORT}/mcp`);
    console.error(`Health check:  http://localhost:${PORT}/health`);
  });

  process.on("SIGTERM", () => {
    console.error("Received SIGTERM, shutting down...");
    httpServer.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
