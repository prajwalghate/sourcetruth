# Blind spots

A blind spot is a call whose target sourcetruth **could not name from the source**. It is shown in
amber with its source line, and it is never guessed.

## Why they matter

A map that quietly drew its best guess would be worse than no map: you'd stop checking exactly where
you most need to. So every blind spot is listed, and the share of links that *could* be traced is in
the top bar.

## What usually causes one

**Solidity**

- `target.delegatecall(data)`, `target.call{value: v}(data)` — low-level calls to an address.
- `payable(to).transfer(amount)`, `to.send(amount)` — ETH sent to an address.
- assembly `call`, `delegatecall`, `create`.
- a method on something whose type can't be worked out — a value decoded from bytes, say.

**Daml**

- a `fetch` or `exercise` on a contract id whose type the parser couldn't follow — for example one
  unpacked from a `let` tuple, or read out of another contract's field.
- an exercise on an interface from a package you didn't point at.

## Reading them

Click **blind spots** in the top bar for the full list, or run:

```bash
sourcetruth ./contracts --holes
```

Each line names the action it's in, the file, and the exact source line. Blind spots that share a
pattern usually share a cause.

## The traced percentage

`94% traced` means 94% of the links between contracts were resolved to a named target. It is a
**confidence level for the rest of the map**, not a score to push up:

- **above 95%** — the map is close to complete;
- **80–95%** — read the blind spots before relying on the wiring;
- **below 80%** — treat the map as partial.

In CI, a drop in the number is useful: it means code arrived that the tool can't follow. See
[In CI](/guide/ci).
