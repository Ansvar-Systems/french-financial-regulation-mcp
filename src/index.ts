#!/usr/bin/env node

/**
 * French Financial Regulation MCP — stdio entry point.
 *
 * Provides MCP tools for querying AMF (Autorité des marchés financiers) and
 * ACPR (Autorité de contrôle prudentiel et de résolution) regulations:
 * provisions, positions, recommandations, instructions, and enforcement actions.
 *
 * Tool prefix: fr_fin_
 * Language: French
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  listSourcebooks,
  searchProvisions,
  getProvision,
  searchEnforcement,
  checkProvisionCurrency,
} from "./db.js";
import { buildCitation } from "./citation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let pkgVersion = "0.1.0";
try {
  const pkg = JSON.parse(
    readFileSync(join(__dirname, "..", "package.json"), "utf8"),
  ) as { version: string };
  pkgVersion = pkg.version;
} catch {
  // fallback to default
}

const SERVER_NAME = "french-financial-regulation-mcp";

// --- Tool definitions --------------------------------------------------------

const TOOLS = [
  {
    name: "fr_fin_search_regulations",
    description:
      "Recherche plein texte dans les dispositions AMF et ACPR. Retourne les règles, positions, recommandations et instructions correspondantes. (Full-text search across AMF and ACPR provisions. Returns matching rules, positions, recommandations, and instructions.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Requête de recherche en français (ex. 'conflits d'intérêts', 'évaluation de l'adéquation', 'abus de marché')",
        },
        sourcebook: {
          type: "string",
          description: "Filtrer par identifiant de recueil (ex. AMF_Reglement_General, AMF_Positions, ACPR_Instructions). Optionnel.",
        },
        status: {
          type: "string",
          enum: ["in_force", "deleted", "not_yet_in_force"],
          description: "Filtrer par statut de la disposition. Par défaut, tous les statuts.",
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats. Par défaut 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fr_fin_get_regulation",
    description:
      "Récupère une disposition AMF ou ACPR spécifique par recueil et référence. Accepte des références telles que 'RG AMF Art. 314-1' ou 'ACPR Instruction 2022-I-01 Art. 5'. (Get a specific AMF or ACPR provision by sourcebook and reference.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        sourcebook: {
          type: "string",
          description: "Identifiant du recueil (ex. AMF_Reglement_General, AMF_Positions, AMF_Doctrine, ACPR_Instructions, ACPR_Recommandations)",
        },
        reference: {
          type: "string",
          description: "Référence complète de la disposition (ex. 'RG AMF Art. 314-1', 'DOC-2019-02 Art. 3', 'ACPR 2022-I-01 Art. 5')",
        },
      },
      required: ["sourcebook", "reference"],
    },
  },
  {
    name: "fr_fin_list_sourcebooks",
    description:
      "Liste tous les recueils AMF et ACPR avec leurs noms et descriptions. (List all AMF and ACPR sourcebooks with names and descriptions.)",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
  {
    name: "fr_fin_search_enforcement",
    description:
      "Recherche les décisions de sanction AMF et ACPR — amendes, interdictions, avertissements et restrictions. (Search AMF and ACPR enforcement actions — fines, bans, warnings, and restrictions.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: {
          type: "string",
          description: "Requête de recherche (ex. nom de l'établissement, type de manquement, 'abus de marché', 'manipulation de cours')",
        },
        action_type: {
          type: "string",
          enum: ["fine", "ban", "restriction", "warning"],
          description: "Filtrer par type de sanction. Optionnel.",
        },
        limit: {
          type: "number",
          description: "Nombre maximum de résultats. Par défaut 20.",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "fr_fin_check_currency",
    description:
      "Vérifie si une référence de disposition AMF ou ACPR est actuellement en vigueur. Retourne le statut et la date d'entrée en vigueur. (Check whether a specific AMF or ACPR provision reference is currently in force.)",
    inputSchema: {
      type: "object" as const,
      properties: {
        reference: {
          type: "string",
          description: "Référence complète de la disposition à vérifier (ex. 'RG AMF Art. 314-1')",
        },
      },
      required: ["reference"],
    },
  },
  {
    name: "fr_fin_about",
    description: "Retourne les métadonnées de ce serveur MCP : version, source des données, liste des outils. (Return metadata about this MCP server: version, data source, tool list.)",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
    },
  },
];

// --- Zod schemas for argument validation ------------------------------------

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

// --- Helper ------------------------------------------------------------------

function textContent(data: unknown) {
  return {
    content: [
      { type: "text" as const, text: JSON.stringify(data, null, 2) },
    ],
  };
}

function errorContent(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true as const,
  };
}

// --- Server setup ------------------------------------------------------------

const server = new Server(
  { name: SERVER_NAME, version: pkgVersion },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: TOOLS,
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params;

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
        return textContent({ results, count: results.length });
      }

      case "fr_fin_get_regulation": {
        const parsed = GetRegulationArgs.parse(args);
        const provision = getProvision(parsed.sourcebook, parsed.reference);
        if (!provision) {
          return errorContent(
            `Disposition introuvable : ${parsed.sourcebook} ${parsed.reference}`,
          );
        }
        const provisionRecord = provision as Record<string, unknown>;
        return textContent({
          ...provisionRecord,
          _citation: buildCitation(
            String(provisionRecord.reference ?? parsed.reference),
            String(provisionRecord.title ?? `${parsed.sourcebook} ${parsed.reference}`),
            "fr_fin_get_regulation",
            { sourcebook: parsed.sourcebook, reference: parsed.reference },
            provisionRecord.url as string | undefined,
          ),
        });
      }

      case "fr_fin_list_sourcebooks": {
        const sourcebooks = listSourcebooks();
        return textContent({ sourcebooks, count: sourcebooks.length });
      }

      case "fr_fin_search_enforcement": {
        const parsed = SearchEnforcementArgs.parse(args);
        const results = searchEnforcement({
          query: parsed.query,
          action_type: parsed.action_type,
          limit: parsed.limit,
        });
        return textContent({ results, count: results.length });
      }

      case "fr_fin_check_currency": {
        const parsed = CheckCurrencyArgs.parse(args);
        const currency = checkProvisionCurrency(parsed.reference);
        return textContent(currency);
      }

      case "fr_fin_about": {
        return textContent({
          name: SERVER_NAME,
          version: pkgVersion,
          description:
            "Serveur MCP pour la réglementation financière française — AMF (Autorité des marchés financiers) et ACPR (Autorité de contrôle prudentiel et de résolution). Donne accès au Règlement Général AMF, aux positions-recommandations, à la doctrine, aux instructions ACPR et aux décisions de sanction.",
          data_sources: [
            "AMF Règlement Général (https://www.amf-france.org/fr/reglementation/reglement-general)",
            "AMF Positions-Recommandations (https://www.amf-france.org/fr/reglementation/doctrine)",
            "AMF Doctrine (https://www.amf-france.org/fr/reglementation/doctrine)",
            "ACPR Instructions (https://acpr.banque-france.fr/reglementation/instructions)",
            "ACPR Recommandations (https://acpr.banque-france.fr/reglementation/recommandations)",
          ],
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description })),
        });
      }

      default:
        return errorContent(`Outil inconnu : ${name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return errorContent(`Erreur lors de l'exécution de ${name} : ${message}`);
  }
});

// --- Main --------------------------------------------------------------------

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`${SERVER_NAME} v${pkgVersion} running on stdio\n`);
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
