# In CI

## GitHub Actions

```yaml
name: sourcetruth
on: [pull_request]

jobs:
  map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with:
          submodules: recursive     # so inherited code and access checks can be read
      - uses: prajwalghate/sourcetruth@v0
        with:
          path: ./contracts
          min-resolution: 90
```

Each run:

- uploads the map as the **`sourcetruth-map`** artifact;
- writes a summary — contracts, actions, traced %, blind spots — on the run page;
- fails if less than `min-resolution` percent of links can be traced.

All inputs and outputs are in the [Action reference](/reference/action).

## Any other CI

```bash
npx @prajwalghate/sourcetruth ./contracts --min-resolution 90
npx @prajwalghate/sourcetruth ./contracts --html -o sourcetruth-map.html
```

`--min-resolution` exits `1` below the floor. Blind spots on their own never fail a run.

## Choosing a floor

Pick it from **today's number**, not from 100. At 94%, set 90. When a pull request makes the number
drop, code arrived that the tool can't follow — worth knowing before it merges, not months into an
audit.

## Diffing maps

Maps are deterministic: the same code produces a byte-identical file (unless you pass `--dated`).
Commit a map, or keep one per release, and a diff shows what changed in the protocol's structure.
