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
