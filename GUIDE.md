# How to use sourcetruth

The same guide, with a live demo, is at **https://prajwalghate.github.io/sourcetruth/**.

sourcetruth reads Daml or Solidity source and draws what it does: who can act, what each action
changes, and what could not be traced. You do the judging. This guide gets you from install to a
first audit, then covers every option.

- [1. Install](#1-install)
- [2. First look: the demo](#2-first-look-the-demo)
- [3. A first audit, step by step](#3-a-first-audit-step-by-step)
- [4. Reading the map](#4-reading-the-map)
- [5. Pointing it at your code](#5-pointing-it-at-your-code)
- [6. Command-line reference](#6-command-line-reference)
- [7. In CI](#7-in-ci)
- [8. What it cannot tell you](#8-what-it-cannot-tell-you)
- [9. Troubleshooting](#9-troubleshooting)

---

## 1. Install

Node 22 or newer. Nothing else.

```bash
npm install -g @prajwalghate/sourcetruth
sourcetruth --version
```

Or without installing, from a clone:

```bash
git clone git@github.com:prajwalghate/sourcetruth.git
node sourcetruth/bin/sourcetruth.mjs --help
```

---

## 2. First look: the demo

```bash
sourcetruth --demo -o demo.html          # a small Solidity vault
sourcetruth --demo daml -o demo-daml.html # a small Daml lending protocol
open demo.html
```

The first time the map opens, a short tour clicks through it for you. The two demos are written to
show everything the map can draw — an open function, a guard hidden in a helper, borrowed authority,
a caller-chosen contract id, and a blind spot — so they are the fastest way to learn to read it.

---

## 3. A first audit, step by step

This walks the Solidity demo. Every step is one click.

1. **Look at the top bar.** `94% traced · 1 blind spot`. Nearly everything the code does could be
   followed. Click **1 blind spot**: `Vault.execute` does a `delegatecall` to an address the caller
   passes in. That is a line to read by hand.

2. **Look at who can act.** On the left: `anyone` is *outside*; `onlyOwner`, `vault` and
   `keepers[msg.sender]` are *inside*. Anything under `anyone` is callable with no access check.

3. **Start where outsiders get in.** The panel on the right lists the actions an outsider can take,
   riskiest first. `takeFee` is there — no check, and it moves tokens.

4. **Open it and press Play.** The map shows `takeFee` writing the vault's storage and calling
   `IERC20` — a transfer to the owner, of an amount the caller chooses.

5. **Check a guarded one.** Click `harvest`. It is guarded by `keepers[msg.sender]`, and the panel
   shows where that check lives: `_onlyKeeper() → require(keepers[msg.sender])`. The guard is a
   helper call, not a modifier — sourcetruth follows those.

6. **Follow the flow.** In `harvest`, press Play: `IStrategy.harvest`, then the fee transfer, then
   `_invest` sending funds back to the strategy. Click `IStrategy` to see the strategy's side.

7. **Read the code.** Every action has a **Code** button that opens its source, comments intact for
   reading — though nothing on the map was derived from them.

The Daml demo reads the same way. There, open `Position.Liquidate`: the liquidator **names
themselves**, passes in the `priceCid` it is checked against, and the action runs with the
authority of `operator` **and** `owner` — the signers of the position, not just the caller.

---

## 4. Reading the map

| On screen | What it shows | What to do with it |
|---|---|---|
| **Outside / Inside** (left, or across the top on a small screen) | Every party the code lets act. *Outside* can act without the protocol's own parties. | Click one: the map lights up every contract they can reach. |
| **The map** | Contracts as cards. Solid arrows *create*, dashed arrows *call*. Dashed cards are defined outside the code you pointed at. | Drag to pan, pinch or ⌘-scroll to zoom, **Fit** to see everything. |
| **Where can someone outside get in?** | Actions an outsider can take alone, riskiest first. | Start at the top. |
| **An action** | Who fires it; what it does to its own contract; **whose authority it also carries**; which contract ids the caller picks; every archive, create and call in code order. | Press **Play** (or `P`). |
| **A contract** | Its life: made by → replaced by → ended by, and who reads it. | Look for *Nothing in this code ends it* on anything that holds value. |
| **Blind spots** (amber) | Calls whose target can't be named from source. | Read them before trusting the rest. |
| **Learn** | Each idea of the language, drawn with contracts from your code. | Read once if the language is new to you. |
| **Code** | The plain listing: every contract, action, authority, link and source body. | Look things up. It is also the whole page with JavaScript off. |

**Colours.** Green made · red archived or ended · blue called or selected · violet authority that is
not the caller's own (a signer's, or no access check at all) · amber could not trace.

**Typefaces.** Monospace is copied from the source. Sans-serif is the tool talking.

`Esc` goes back a step. Links open the map at a place, on load or while it is open: `#e-Vault-takeFee` an action, `#u-Vault` a contract, `#a-anyone` a party, `#learn` the Learn view, `#map` the start — so a runbook or a ticket can point straight at what it means.

### How "outside" is decided

From the code, never from names.

- **Daml:** the parties who sign the contracts nothing in the code creates are *inside*, and so are
  the signers of any contract only ever created with an inside party's consent. A party who can act
  without any of them is *outside*.
- **Solidity:** a function with no access check is callable by *anyone*. A named check is a
  privilege, and whoever holds it is *inside*.

### How Solidity access checks are found

A check counts when it runs on every path: in a modifier that checks the caller, or as a top-level
`require` / `if (...) revert` on `msg.sender` — in the function itself or in a helper it calls,
through inheritance and into vendored libraries. A check inside an `if` does **not** count: claiming a
guard that might not run would hide an open function. `a || b` means either may call.

---

## 5. Pointing it at your code

Point it at a repository root, or at the folder that holds the source. The language is detected.

**Daml.** `.daml` files are read recursively. Skipped: `.daml/` build output, and test packages —
any package whose `daml.yaml` name ends in `-test` or `-tests`, and directories named `test`/`tests`.

**Solidity.** `.sol` files are read recursively. Skipped by default:

- your dependencies in `lib/` (Foundry) and `node_modules/` — still **read**, to follow inheritance
  and access checks, but not drawn as your code (`--include-libs` draws them);
- tests and scripts: `test/`, `tests/`, `script/`, `scripts/`, `TestContracts/`, `mocks/`, `*.t.sol`,
  `*.s.sol` (`--include-tests` brings them back).

Imports are followed the way the compiler would: relative paths, `remappings.txt` and `foundry.toml`
remappings, `node_modules`, and nested dependencies. Public functions a contract inherits from a
vendored parent — `deposit()` from an ERC4626 base, say — appear on that contract, running the
contract's own overrides.

**If dependencies are missing** — typically a git submodule that was never initialised — the map
says so at the top, and every function whose access might depend on the missing code is marked. Run
`forge install` or `git submodule update --init` and generate the map again.

---

## 6. Command-line reference

```
sourcetruth <dir> [mode] [options]
```

| Mode | Output |
|---|---|
| *(none)* | Summary and blind spots in the terminal |
| `--html` | The interactive map, one self-contained file |
| `--surface` | State-changing actions at most one party can take alone |
| `--holes` | Only the calls that could not be traced |
| `--graph` | Contract-to-contract creates and calls |
| `--json` | The full model (see below) |

| Option | |
|---|---|
| `-o, --out <file>` | Write to a file instead of stdout |
| `--title <text>` | Name the map (default: the directory name) |
| `--lang daml\|evm` | Force the language |
| `--min-resolution N` | Exit 1 if less than N% of links could be traced |
| `--include-tests` | Include test packages and test contracts |
| `--include-libs` | Draw vendored dependencies as if they were your code |
| `--dated` | Stamp today's date on the map (off by default, so maps from the same commit are identical) |
| `--demo [daml\|solidity]` | Render a bundled example |
| `-v, --version` · `-h, --help` | |

**Exit codes.** `0` success · `1` nothing found, or below `--min-resolution` · `2` bad usage.
Blind spots alone never fail a run.

**JSON.** `--json` prints `{ "schemaVersion": 1, "tool": {...}, "units": [...], "entries": [...], ... }`.
`schemaVersion` changes only when a field changes meaning or is removed.

```bash
# every state-changing function with no access check
sourcetruth ./src --json | jq -r '.entries[] | select(.authority == [] and .effect != "none" and (.declared|not)) | "\(.unit).\(.name)"'
```

---

## 7. In CI

### GitHub Actions

```yaml
name: sourcetruth
on: [pull_request]
jobs:
  map:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          submodules: recursive        # so inherited code and access checks can be read
      - uses: prajwalghate/sourcetruth@v0
        with:
          path: ./contracts
          min-resolution: 90
```

Inputs: `path`, `title`, `min-resolution` (0 = off), `output` (default `sourcetruth-map.html`),
`include-tests`, `upload`. Outputs: `resolution`, `blind-spots`. Each run uploads the map as the
`sourcetruth-map` artifact and writes a summary table.

### Anywhere else

```bash
npx @prajwalghate/sourcetruth ./contracts --min-resolution 90
```

Pick the floor from today's number, not from 100: if you are at 94%, set 90. When a change makes the
number drop, a construct the tool can't follow has arrived — worth knowing on the pull request.

---

## 8. What it cannot tell you

- **Whether anything is a bug.** It draws; you judge.
- **Runtime facts.** Which contract id a caller will actually pass, who holds a role, what a proxy
  currently points at, what value a price has.
- **Branches.** It cannot tell which path runs. An action that archives a contract and creates one
  is shown as possibly replacing it *and* possibly ending it.
- **Arithmetic.** Overflow, rounding, decimals — none of it.
- **Inside a blind spot.** A `delegatecall` to a caller's address, an assembly `call`, a receiver
  whose type can't be worked out: shown, never followed.
- **Code that isn't on disk.** Missing imports are reported, not guessed.

---

## 9. Troubleshooting

**"0 contracts found."** You pointed at build output or an empty folder. Point at the repository
root or the source folder.

**A function you know is guarded shows as `anyone`.** Check the top of the map for a *not on disk*
note — the guard may live in a dependency that isn't installed. If everything resolved, the check
may be inside an `if`, which is deliberately not credited. The **Code** button shows the source.

**A contract is missing.** It may be in a skipped folder (`test/`, `mocks/`, `TestContracts/`,
`lib/`). Use `--include-tests` or `--include-libs`.

**Resolution is lower than you expected.** Run `sourcetruth <dir> --holes` and look at the lines:
they share a pattern, and that pattern is what the tool couldn't follow.

**The map looks empty.** Click **Fit** (bottom right). On very large codebases the opening view
zooms in on the riskiest action so the cards are readable.
