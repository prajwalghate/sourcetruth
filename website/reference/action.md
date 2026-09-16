# GitHub Action

```yaml
- uses: prajwalghate/sourcetruth@v0
  with:
    path: ./contracts
    min-resolution: 90
```

## Inputs

| Input | Default | |
|---|---|---|
| `path` | `.` | Directory holding the Daml or Solidity source |
| `title` | the repository name | Name shown on the map |
| `min-resolution` | `0` | Fail below this traced percentage; `0` turns the check off |
| `output` | `sourcetruth-map.html` | File to write the map to |
| `include-tests` | `false` | Also map test code |
| `upload` | `true` | Upload the map as the `sourcetruth-map` artifact |

## Outputs

| Output | |
|---|---|
| `resolution` | Percentage of links traced |
| `blind-spots` | Number of links that couldn't be traced |

```yaml
- id: map
  uses: prajwalghate/sourcetruth@v0
  with:
    path: ./contracts
- run: echo "traced ${{ steps.map.outputs.resolution }}%, ${{ steps.map.outputs.blind-spots }} blind spots"
```

## What a run produces

- the map, uploaded as an artifact — download it and open the HTML file;
- a summary table on the run page, plus any warnings such as missing imports;
- a failed step, with an error annotation, when `min-resolution` isn't met.

Check out submodules (`submodules: recursive`) so inherited code and access checks can be read.

## Runners

GitHub-hosted runners work as they are. On a self-hosted runner, use runner version 2.327.1 or
newer; the actions this one builds on run on Node 24.

The action sets up Node 22, and later steps in the same job see that Node too — if they need another
version, set it up after this step. It turns no dependency caching on.
