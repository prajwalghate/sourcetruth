# What is sourcetruth?

sourcetruth reads **Daml** or **Solidity** source code and draws what it does: every party that can
act, every action they can take, and what each action changes. Where it can't work something out
from the source, it says so — in amber, on the map — instead of guessing.

It is built for the first hours of reviewing a protocol you didn't write: finding your way in,
seeing where value moves, and knowing which lines you still have to read by hand.

## What you get

A single HTML file you can click through:

- **Who can act.** Parties split into *outside* the protocol and *inside* it, derived from the code.
- **What an action does.** Press **Play** to watch it archive, create and call — in code order.
- **Whose authority it carries.** An action can run with more authority than its caller holds.
- **Each contract's life.** What makes it, what replaces it, what ends it.
- **Blind spots.** Every call that couldn't be traced, with its source line.

It also works in the terminal and in CI — see [Command line](/reference/cli) and [In CI](/guide/ci).

## What it is not

It is **not a bug finder.** It has no vulnerability patterns and makes no judgement about whether
code is wrong. It shows what the code does so a person can decide, and it stores no findings.

## Three rules it never breaks

**Comments are never evidence.** Every comment is stripped before anything is read. Comments that
describe behaviour the code doesn't have are common, and a reader who trusts one stops checking.

**Blind spots are never guessed.** A call whose target can't be determined is reported with its raw
line. An arrow that isn't on the map means *unproven*, never *nothing there*.

**Access comes from code, not names.** Who is inside the protocol comes from signatories and access
checks. A Solidity modifier called `onlyOwner` that never looks at the caller is shown as open.

## Next

- [Getting started](/guide/getting-started) — install it and draw your first map
- [A first audit](/guide/first-audit) — walk the demo step by step
