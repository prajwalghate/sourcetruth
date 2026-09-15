# Solidity

## What is drawn, and what is only read

sourcetruth **draws** your code and **reads** your dependencies.

Drawn by default: `.sol` files under the folder you point at, except

- `lib/` next to `foundry.toml` or at the root, and `node_modules/` — dependencies;
- `test/`, `tests/`, `script/`, `scripts/`, `TestContracts/`, `mocks/`, `*.t.sol`, `*.s.sol`.

`--include-libs` and `--include-tests` draw those too.

Dependencies are still **read**: imports are followed the way the compiler would — relative paths,
`remappings.txt` and `foundry.toml` remappings, `node_modules`, and nested dependencies — so
inheritance and access checks that live there are found.

## Calls

Every `name(...)` in every function body is classified as a call to a named contract, a blind spot,
an internal call, or not a call (an event, a cast, a builtin). Nothing is dropped. Calls are traced
through:

- typed state variables, parameters, locals, return values, and array or mapping elements
  (`strategies[i].harvest()`);
- casts (`IERC20(token).transfer(...)`), `this.`, and `super.`;
- `using SafeERC20 for IERC20` and static library calls — shown against the token they act on;
- overloads, matched by argument count;
- internal helpers, own and inherited, with the helper named on each step.

## Inherited functions

A contract's surface includes the public functions it inherits from **vendored** parents. A vault
built on OpenZeppelin's ERC4626 is deposited into through OpenZeppelin's `deposit()` — which then runs
the vault's own `_deposit` override. That flow appears on the vault, marked *inherited from ERC4626*.
In-repo parents keep their functions on their own cards.

## Access checks

See [Who can act](/guide/who-can-act#access-checks-in-solidity). In short: modifiers and top-level
checks on the caller count, through helpers, inheritance and vendored code; a check inside an `if`
does not.

## Not actions

- **Constructors** run once, when the contract is deployed.
- **Interface and abstract declarations** have no code.

Neither is listed as something anyone can call.

## Missing dependencies

If an import isn't on disk — most often a git submodule that was never initialised — the map says so
at the top, and each function that relies on unread code is marked *relies on code that isn't on
disk*. Such a function may be guarded in code the tool couldn't see.

```bash
forge install          # or: git submodule update --init --recursive
```
