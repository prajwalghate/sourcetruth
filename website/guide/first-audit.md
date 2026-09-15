# A first audit

This walks the bundled Solidity vault. Every step below is one click in the map beside it —
**try them**.

<DemoMap :tabs="false" :height="600" />

## The same steps, in words

1. **Find the blind spot.** Top right: `1 blind spot`. Nearly everything the code does could be
   followed; one call couldn't. Click it — `Vault.execute` does a `delegatecall` to an address the
   caller passes in. That line gets read by hand.

2. **See who can act.** `anyone` is *outside*: functions with no access check at all. `onlyOwner`,
   `vault` and `keepers[msg.sender]` are *inside*.

3. **Start where outsiders get in.** The panel lists what an outsider can do alone, riskiest first.
   `takeFee` is there: no check, and it moves tokens.

4. **Press Play.** `takeFee` writes the vault's storage and calls `IERC20` — a transfer to the
   owner, of an amount the caller chooses.

5. **Check a guarded one.** `harvest` is limited to `keepers[msg.sender]`, and the panel shows where
   that check lives: `_onlyKeeper() → require(keepers[msg.sender], "not keeper")`. It's a helper
   call, not a modifier — sourcetruth follows those.

6. **Follow the flow.** Play `harvest`: `IStrategy.harvest`, then the fee transfer, then `_invest`
   sending funds back to the strategy. Click `IStrategy` or the `Strategy` card to see the other side.

7. **Read the code.** Every action has a **Code** button. Source is shown with comments intact for
   reading — but nothing on the map was derived from them.

## The Daml example

Switch to **Daml lending** on the [demo page](/demo) and open `Position.Liquidate`:

- the liquidator **names itself** — `liquidator` is an argument of the choice;
- it **supplies the price** it is checked against — `priceCid` is chosen by the caller;
- it runs with the authority of **`operator` and `owner`**, the signers of the position, not only
  its own.

Each of those is a question worth an hour of review, and none of them is visible from the controller
line alone.
