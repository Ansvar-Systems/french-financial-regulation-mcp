# Tools Reference

All tools use the `fr_fin_` prefix. Tools are available via both stdio (`src/index.ts`) and HTTP (`src/http-server.ts`) transports.

Every response includes a `_meta` block with disclaimer, data_age, copyright, and source_url fields.

---

## fr_fin_search_regulations

Full-text search across AMF and ACPR provisions (rules, positions, recommandations, instructions).

**Input**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query in French (e.g. `conflits d'intérêts`, `abus de marché`) |
| `sourcebook` | string | no | Filter by sourcebook ID (e.g. `AMF_Reglement_General`, `ACPR_Instructions`) |
| `status` | `in_force` \| `deleted` \| `not_yet_in_force` | no | Filter by provision status. Defaults to all. |
| `limit` | number | no | Maximum results to return. Default 20, max 100. |

**Output**

```json
{
  "results": [ /* Provision objects */ ],
  "count": 5,
  "_meta": { "disclaimer": "...", "data_age": "...", "copyright": "...", "source_url": "..." }
}
```

---

## fr_fin_get_regulation

Retrieve a specific AMF or ACPR provision by sourcebook and reference.

**Input**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `sourcebook` | string | yes | Sourcebook ID (e.g. `AMF_Reglement_General`, `ACPR_Instructions`) |
| `reference` | string | yes | Provision reference (e.g. `RG AMF Art. 314-1`, `DOC-2019-02 Art. 3`) |

**Output**

```json
{
  "id": 42,
  "sourcebook_id": "AMF_Reglement_General",
  "reference": "RG AMF Art. 314-1",
  "title": "...",
  "text": "...",
  "type": "rule",
  "status": "in_force",
  "effective_date": "2022-01-01",
  "_citation": {
    "canonical_ref": "RG AMF Art. 314-1",
    "display_text": "...",
    "lookup": { "tool": "fr_fin_get_regulation", "args": { "sourcebook": "...", "reference": "..." } }
  },
  "_meta": { "disclaimer": "...", "data_age": "...", "copyright": "...", "source_url": "..." }
}
```

Returns an error if the provision is not found.

---

## fr_fin_list_sourcebooks

List all AMF and ACPR sourcebooks with names and descriptions.

**Input:** none

**Output**

```json
{
  "sourcebooks": [
    { "id": "AMF_Reglement_General", "name": "Règlement Général AMF", "description": "..." },
    ...
  ],
  "count": 5,
  "_meta": { ... }
}
```

---

## fr_fin_search_enforcement

Search AMF and ACPR enforcement actions — fines, bans, warnings, and restrictions.

**Input**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `query` | string | yes | Search query (firm name, violation type, e.g. `abus de marché`) |
| `action_type` | `fine` \| `ban` \| `restriction` \| `warning` | no | Filter by sanction type. |
| `limit` | number | no | Maximum results. Default 20, max 100. |

**Output**

```json
{
  "results": [
    {
      "id": 1,
      "firm_name": "...",
      "reference_number": "...",
      "action_type": "fine",
      "amount": 500000,
      "date": "2023-06-15",
      "summary": "...",
      "sourcebook_references": "..."
    }
  ],
  "count": 1,
  "_meta": { ... }
}
```

---

## fr_fin_check_currency

Check whether a specific AMF or ACPR provision reference is currently in force.

**Input**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `reference` | string | yes | Provision reference (e.g. `RG AMF Art. 314-1`) |

**Output**

```json
{
  "reference": "RG AMF Art. 314-1",
  "status": "in_force",
  "effective_date": "2022-01-01",
  "found": true,
  "_meta": { ... }
}
```

`status` is one of `in_force`, `deleted`, `not_yet_in_force`, or `unknown` (if not found). `found` is `false` when the reference is not in the database.

---

## fr_fin_about

Return metadata about this MCP server: version, data sources, and list of available tools.

**Input:** none

**Output**

```json
{
  "name": "french-financial-regulation-mcp",
  "version": "0.1.0",
  "description": "...",
  "data_sources": [ "..." ],
  "tools": [ { "name": "...", "description": "..." } ],
  "_meta": { ... }
}
```

---

## fr_fin_check_data_freshness

Returns record counts and the date of the latest indexed enforcement action. Use this to assess data currency before relying on search results.

**Input:** none

**Output**

```json
{
  "provisions_count": 1250,
  "enforcement_count": 87,
  "latest_enforcement_date": "2024-11-20",
  "_meta": { ... }
}
```

---

## fr_fin_list_sources

Returns official source URLs for AMF and ACPR data used by this server, with sourcebook IDs for cross-referencing.

**Input:** none

**Output**

```json
{
  "sources": [
    {
      "name": "AMF Règlement Général",
      "authority": "Autorité des marchés financiers",
      "url": "https://www.amf-france.org/fr/reglementation/reglement-general",
      "sourcebook_id": "AMF_Reglement_General"
    },
    ...
  ],
  "_meta": { ... }
}
```
