# Who can act

The left of the map lists every party the code lets take an action, in two groups. Both groups are
**derived from the code**. Nothing is inferred from what a party or function is called.

## Outside and inside

### Daml

- Parties who **sign the contracts nothing in the code creates** are *inside* — they set the
  protocol up.
- So are the signers of any contract that is **only ever created with an inside party's consent**.
- A party who can take at least one action **without any inside party** is *outside*.
- A party who only ever acts *alongside* an inside party — an oracle pusher, a mint recipient —
  can't do anything alone, so is grouped inside.

A list of "operator-sounding" names was tried first and got it backwards: `owner` sounds like an
admin, but in a lending protocol `owner` is the borrower — the main outside user.

### Solidity

- A function with **no access check** is callable by **anyone**, and `anyone` is outside.
- A named check — a modifier that checks the caller, or `require(msg.sender == x)` — is a privilege,
  and whoever holds it is inside.

## Access checks in Solidity

A check counts when it **runs on every path**:

- a modifier whose body checks the caller — directly (`msg.sender`, `_msgSender()`, `hasRole`), or
  through a helper such as `_checkOwner()` whose code is on disk;
- a top-level `require(...)` or `if (...) revert` on the caller, in the function itself;
- the same, in a **helper the function calls at top level** — `onlyManager();` — including helpers
  inherited from parents and from vendored libraries.

A check **inside an `if` does not count.** Claiming a guard that might not run would hide an open
function, which is the one mistake a map of access must not make.

| Source | Shown as |
|---|---|
| `require(msg.sender == manager)` | `manager` |
| `if (msg.sender != vault) revert()` | `vault` |
| `require(msg.sender == a \|\| msg.sender == b)` | `a or b` — either may call |
| `require(hasRole(KEEPER_ROLE, msg.sender))` | `KEEPER_ROLE` |
| `require(whitelist[msg.sender])` | `whitelist[msg.sender]` |
| a modifier like `nonReentrant` | a guard, not a party |

## Authority beyond the caller

### Borrowed authority (Daml)

Exercising a choice runs with the authority of its **controller plus every signatory of the
contract** the choice is on. A choice a liquidator controls, on a position signed by `operator` and
`owner`, runs with all three. The action panel says so in violet: *also carries the authority of
`operator` `owner`*.

### Who acts is an argument

When a controller is one of the choice's own arguments, whoever exercises it **names the party that
acts**. The panel flags it: *who acts is an argument — the caller names `liquidator`*.

### Contract ids the caller chooses

A `ContractId` in a choice's arguments is picked by the caller. If the choice doesn't check it got
the contract it expected, the caller can pass a different one. The panel lists them: *the caller
picks these contract ids*.
