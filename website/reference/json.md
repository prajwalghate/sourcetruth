# JSON model

`--json` prints everything sourcetruth knows about the code, for your own tooling.

```bash
sourcetruth ./contracts --json -o model.json
```

## Versioning

The document starts with:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "sourcetruth", "version": "0.1.0" },
  "language": "solidity",
  "root": "/path/you/passed",
  "...": "..."
}
```

`schemaVersion` changes only when a field changes meaning or is removed. New fields may appear
without a bump.

## Top level

| Field | |
|---|---|
| `language` | `"daml"` or `"solidity"` |
| `units` | Contracts (Daml templates, Solidity contracts, interfaces, libraries) |
| `entries` | Actions (Daml choices, Solidity external/public functions) |
| `holes` | Every blind spot, with the action it belongs to |
| `stats` | `units`, `entries`, `edges`, `holes`, `resolution` (% traced), `soloAuthority`, `terminal` |
| `notes` | Plain-language warnings, such as imports that aren't on disk |

## An entry

| Field | |
|---|---|
| `unit`, `name` | The contract and the action |
| `path`, `line` | Where it is written |
| `authority` | Who can take it, as the source names them. Empty in Solidity means **anyone** |
| `effect` | `"none"` (repeatable), `"transition"` (changes it), `"terminal"` (ends it) |
| `args` | `{ name, type }` for each argument |
| `guards` | Checks and non-access modifiers, as source lines |
| `edges` | What it touches — see below |
| `holes` | Number of blind spots |
| `source` | The action's source, comments intact (display only) |
| `declared` | *Solidity* — a declaration with no code |
| `deployOnly` | *Solidity* — a constructor |
| `inherited` | *Solidity* — the vendored parent it was inherited from |
| `unread` | *Solidity* — helpers or modifiers it relies on whose code isn't on disk |

## An edge

| Field | |
|---|---|
| `kind` | `"create"`, `"call"`, `"read"` or `"destroy"` |
| `target` | The contract it reaches, or `null` for a blind spot |
| `resolved` | `false` for a blind spot |
| `raw` | The source line |
| `through` | The helper function the edge is written in, if any |
| `external` | The target isn't defined in the code you pointed at |
| `meta` | Details, e.g. `{ "lowLevel": "delegatecall" }`, `{ "eth": true }`, `{ "library": "SafeERC20" }` |

## Recipes

```bash
# every state-changing function with no access check
jq -r '.entries[] | select(.authority == [] and .effect != "none" and (.declared|not) and (.deployOnly|not)) | "\(.unit).\(.name)"' model.json

# every blind spot, with where it is
jq -r '.holes[] | "\(.path)  \(.owner)  \(.raw)"' model.json

# actions that carry an inherited vendored implementation
jq -r '.entries[] | select(.inherited) | "\(.unit).\(.name) from \(.inherited)"' model.json
```
