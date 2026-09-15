# Command line

```
sourcetruth <dir> [mode] [options]
```

## Modes

Pick one. Without a mode, sourcetruth prints a summary and the blind spots.

| Mode | Output |
|---|---|
| `--html` | The interactive map, as one self-contained HTML file |
| `--surface` | State-changing actions that at most one party can take alone |
| `--holes` | Only the calls that couldn't be traced, with their source lines |
| `--graph` | Which contract creates or calls which |
| `--json` | The full model — see [JSON model](/reference/json) |

## Options

| Option | |
|---|---|
| `-o, --out <file>` | Write the output to a file instead of stdout |
| `--title <text>` | Name the map (default: the directory name) |
| `--lang daml\|evm` | Force the language instead of detecting it |
| `--min-resolution <N>` | Exit 1 if less than N% of links could be traced |
| `--include-tests` | Also draw test packages, `test/`, `TestContracts/`, `mocks/`, `*.t.sol` |
| `--include-libs` | Draw vendored dependencies as if they were your code |
| `--dated` | Stamp today's date on the map (off by default, so maps of the same code are identical) |
| `--demo [daml\|solidity]` | Render a bundled example instead of `<dir>` |
| `-v, --version` | Print the version |
| `-h, --help` | Print usage |

## Exit codes

| Code | Meaning |
|---|---|
| `0` | Mapped |
| `1` | Nothing found, or traced below `--min-resolution` |
| `2` | Bad usage — unknown option, missing directory, unknown language |

Blind spots on their own never change the exit code.

## Examples

```bash
sourcetruth --demo -o demo.html
sourcetruth ./contracts --html -o map.html --title "Vault v2 review"
sourcetruth ./daml --surface
sourcetruth ./src --holes
sourcetruth ./src --min-resolution 90
sourcetruth . --json -o model.json
```
