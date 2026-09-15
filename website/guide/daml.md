# Daml

## What is read

Every `.daml` file under the folder you point at. Skipped:

- `.daml/` — Daml's build output, full of decompiled dependency stubs;
- **test packages** — any package whose `daml.yaml` name ends in `-test` or `-tests`, and directories
  named `test` or `tests`. The folder you point at is never skipped, so pointing straight at a test
  package maps it. `--include-tests` brings them all back.

## How the language maps

| Daml | On the map |
|---|---|
| `template` | a contract card |
| `signatory` | stamps on the card; the source of *inside* parties |
| `controller` | who can act |
| `choice` | an action |
| `create` / `fetch` / `exercise` / `archive` | made / read / called / archived |
| consuming choice that re-creates `this` | *changes it* |
| consuming choice with no successor | *ends it* |
| `nonconsuming choice` | *repeatable* |

## Helper functions

Choices often do their ledger work in top-level functions:

```haskell
archiveMirror : ContractId Mirror -> Update ()
archiveMirror mirrorCid = archive mirrorCid
```

Those edges are folded into every choice that calls the helper, and labelled with it — the action
panel says *archived · in `archiveMirror`* — so you're sent to the right twenty lines.

## Contract lives, and branches

A contract's life is **made by → replaced by → ended by**. Replacements include actions on *other*
contracts that archive this one and create it again — how a position is usually updated from its
pool.

The tool can't tell which branch runs. An action that always archives a position but only creates a
new one `if` there's something left is shown **both** as replacing it and, under *ended by*, as
*archive it, and may not make a new one*. So "nothing ends it" is only ever shown when nothing in
the code could.

## What resolves, and what doesn't

Contract ids are typed through choice arguments, template fields, exercise results (including
tuples and wrapped lines), `case` patterns, lambdas over lists and helper signatures. What isn't
followed becomes a [blind spot](/guide/blind-spots).
