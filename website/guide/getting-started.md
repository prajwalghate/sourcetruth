# Getting started

## Requirements

- Node.js **22** or newer
- Daml source (`.daml`) or Solidity source (`.sol`)

sourcetruth has no dependencies and runs entirely locally. Nothing is uploaded anywhere.

## Install

::: code-group

```bash [npm]
npm install -g @prajwalghate/sourcetruth
```

```bash [pnpm]
pnpm add -g @prajwalghate/sourcetruth
```

```bash [yarn]
yarn global add @prajwalghate/sourcetruth
```

```bash [npx — no install]
npx @prajwalghate/sourcetruth --help
```

:::

Check it works:

```bash
sourcetruth --version
```

## Your first map

Start with a bundled example, so you learn to read the map on code written to show everything it
can draw:

```bash
sourcetruth --demo -o demo.html
```

Open `demo.html` in a browser: double-click it, or run `open demo.html` on a Mac (`xdg-open` on
Linux, `start` on Windows).

The first time a map opens, a short tour clicks through it for you. There is a Daml example too:

```bash
sourcetruth --demo daml -o demo-daml.html
```

## Map your own code

Point it at a repository root, or at the folder holding the source. The language is detected.

```bash
sourcetruth ./contracts --html -o map.html
```

Other ways to look at the same code:

| Command | Shows |
|---|---|
| `sourcetruth ./contracts` | A summary and the blind spots, in the terminal |
| `sourcetruth ./contracts --surface` | Actions at most one party can take alone |
| `sourcetruth ./contracts --holes` | Only what couldn't be traced |

::: tip Solidity projects
Install your dependencies first (`forge install`, or `git submodule update --init`). sourcetruth
reads inherited code and access checks from them. If they're missing, the map tells you which
functions may be guarded in code it couldn't read.
:::

## Next

- [A first audit](/guide/first-audit) — what to look at, in what order
- [Reading the map](/guide/reading-the-map) — every part of the screen
