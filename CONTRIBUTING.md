# Contributing

Thanks for helping. sourcetruth is small, has no dependencies, and runs on Node 22+.

```bash
git clone https://github.com/prajwalghate/sourcetruth.git
cd sourcetruth
npm test                                    # the whole suite
node bin/sourcetruth.mjs --demo -o demo.html
```

The documentation site lives in `website/` (VitePress):

```bash
cd website && npm install && npm run dev
```

## Reporting a problem

The most useful report is **a small piece of Daml or Solidity that the tool gets wrong**, the command
you ran, and what you expected. A wrong fact on the map — a guard it missed, a call it drew that
never happens, a blind spot that shouldn't be one — matters more than anything cosmetic.

## Changing how code is read

The adapters (`src/adapters/`) decide what the map claims, so changes there follow three rules:

1. **Never guess.** If a target or a party can't be determined from source, it is a blind spot.
   A wrong arrow is worse than a missing one.
2. **Add a fixture that shows the case**, in `test/`, and a test that pins it.
3. **Prove the test can fail.** Temporarily undo your change and confirm the test goes red, then
   restore it. A test that passes whether or not the fix is there doesn't protect anything.

Comments in source are stripped before parsing — no change may make the tool read them.

## The map

`src/view.mjs` computes everything the page shows; `src/client/app.js` only renders it. Keep facts
in `view.mjs`, where they can be tested, and text from source out of `innerHTML`.
