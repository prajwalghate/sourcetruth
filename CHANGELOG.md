# Changelog

## 0.1.1 — 2026-09-17

- **Maps no longer contain the path to the folder you scanned.** 0.1.0 printed the full path (your
  username, the folders above the project) in the map's code view; a map now shows the folder's name
  only. `--json` still carries the full path in `root`, for scripts; remove it before sharing.
- **Solidity tracing follows library bodies and resolves names the way the compiler does.**
  A name now means what the file's imports say, so a repository that vendors two `ERC20`s (say
  OpenZeppelin and solmate) no longer gets the wrong parent — and the wrong `balanceOf`. A library
  function's body is followed like a helper's: OpenZeppelin's receiver checks resolve to the
  receiver interface instead of a blind spot; an `assembly` block that only re-throws is not a
  call; a Yul `call` whose receiver has a contract type is a named edge; precompiles are not
  contracts. Struct fields of call results are typed, structs declared at file level are seen,
  a function pointer is bound to the function the caller passes, and inheritance is linearized
  the way the compiler does it, so an implementation is never hidden behind the interface it
  fulfils. On Damn Vulnerable DeFi:
  39 blind spots → 26, every one of them a genuine low-level call, ETH send or `create`.
- **Docs paste cleanly into zsh**, the macOS default: no `#` notes or `<placeholders>` inside command
  blocks. A test keeps it that way.
- **GitHub Action:** now on `actions/setup-node@v7` and `actions/upload-artifact@v7`, which run on
  Node 24 — GitHub is retiring Node 20 on its runners. Self-hosted runners need version 2.327.1 or
  newer. Dependency caching stays off, so the action can't fail in a repository that names npm as its
  package manager but has no lockfile.
- **Releases** are published from GitHub Actions without an npm token (npm trusted publishing),
  still with provenance.
- `package.json` is written the way npm publishes it, so publishing no longer warns about the `bin`
  path. CI now fails if npm would have to rewrite `package.json`.

## 0.1.0 — 2026-09-16

First release.

- **Daml and Solidity** source, detected automatically.
- **The map** (`--html`): who can act, split into outside and inside the protocol; each action's
  archives, creates and calls in code order, with **Play**; whose authority an action carries beyond
  its caller; which contract ids the caller chooses; each contract's life; blind spots in amber.
  One self-contained file, deterministic, with a guided tour and a Learn view drawn from your code.
- **Solidity tracing**: every call site classified — typed variables, casts, libraries, `this.`, ETH
  and low-level calls — with nothing dropped. Access checks followed through helpers, inheritance
  and vendored modifiers, credited only when they run on every path. Inherited public functions from
  vendored parents appear on the contracts that run them. Imports resolved through remappings,
  node_modules and nested dependencies; missing ones reported.
- **Daml tracing**: controllers, signatories, consuming effects, helper functions folded into the
  choices that call them, test packages excluded.
- `--surface`, `--holes`, `--graph`, `--json` (schemaVersion 1), `--min-resolution` for CI,
  `--demo`, `-o`.
- **GitHub Action** (`action.yml`): builds the map, uploads it, writes a run summary, and can fail
  below a resolution floor.
