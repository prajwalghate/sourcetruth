# Reading the map

## The screen

| On screen | What it shows | What to do with it |
|---|---|---|
| **Outside / Inside** | Every party the code lets act. *Outside* can act without the protocol's own parties. | Click one: the map lights up every contract they can reach. |
| **The map** | Contracts as cards. Solid arrows *create*, dashed arrows *call*. Dashed cards are defined outside the code you pointed at. | Drag to pan, pinch or ⌘-scroll to zoom, **Fit** to see everything. |
| **Where can someone outside get in?** | Actions an outsider can take alone, riskiest first. | Start at the top. |
| **An action** | Who fires it; what it does to its own contract; whose authority it also carries; which contract ids the caller picks; every archive, create and call in code order. | Press **Play**. |
| **A contract** | Its life: made by → replaced by → ended by, and who reads it. | Look for *Nothing in this code ends it* on anything that holds value. |
| **Blind spots** | Calls whose target can't be named from source. | Read them before trusting the rest. |
| **Learn** | Each idea of the language, drawn with contracts from your code. | Read it once if the language is new to you. |
| **Code** | The plain listing: every contract, action, authority, link and source body. | Look things up. It is also the whole page with JavaScript off. |

## Colours

Every colour means one thing, and none is used alone — each also has a label or a shape.

<div class="legend">
  <div class="key"><span class="swatch" style="color: var(--st-make)"></span><div><b>Made</b><span class="what">the action creates this contract</span></div></div>
  <div class="key"><span class="swatch" style="color: var(--st-end)"></span><div><b>Archived or ended</b><span class="what">consumed, with or without a successor</span></div></div>
  <div class="key"><span class="swatch" style="color: var(--st-flow)"></span><div><b>Called · selected</b><span class="what">the action calls into it, or you picked it</span></div></div>
  <div class="key"><span class="swatch" style="color: var(--st-power)"></span><div><b>Authority not the caller's own</b><span class="what">a signer's, or no access check at all</span></div></div>
  <div class="key"><span class="swatch dashed" style="color: var(--st-blind)"></span><div><b>Couldn't trace</b><span class="what">a blind spot — read that line yourself</span></div></div>
  <div class="key"><span class="swatch dashed" style="color: var(--vp-c-text-3)"></span><div><b>Outside this code</b><span class="what">defined in a dependency</span></div></div>
</div>

## Typefaces

**Monospace is copied from the source** — contract names, parties, lines of code. **Sans-serif is the
tool talking.** You can always tell evidence from commentary.

## Effects

What an action does to the contract it's on:

- **changes it** — Daml: archives it and makes a new version. Solidity: writes its storage.
- **ends it** — archives it with nothing in its place.
- **repeatable** — leaves it in place, so it can run again and again. This says nothing about what
  *else* it does: a repeatable action can still mint and move value.

## Keyboard and links

- `Esc` goes back a step · `P` plays the selected action.
- Links open the map at a place, on load or while it's open:

| Link | Opens |
|---|---|
| `map.html#e-Vault-takeFee` | an action |
| `map.html#u-Vault` | a contract |
| `map.html#a-anyone` | a party |
| `map.html#learn` | the Learn view |
| `map.html#map` | the start |

Put these in a ticket or a runbook to point straight at what you mean.
