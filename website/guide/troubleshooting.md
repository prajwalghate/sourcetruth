# Troubleshooting

## "0 contracts found"

You pointed at build output or an empty folder. Point at the repository root or the source folder.

## A function I know is guarded shows as `anyone`

1. Look at the top of the map for a **not on disk** note — the guard may live in a dependency that
   isn't installed. Run `forge install` or `git submodule update --init` and map again.
2. If everything resolved, open the function's **Code**. A check inside an `if` is deliberately not
   credited, because it might not run.

## A contract is missing

It may be in a folder that isn't drawn by default: `test/`, `mocks/`, `TestContracts/` or `lib/`.
Use `--include-tests` or `--include-libs`.

## The traced percentage is lower than I expected

```bash
sourcetruth ./contracts --holes
```

The blind spots usually share a pattern, and that pattern is what the tool couldn't follow.

## The map looks empty, or everything is tiny

Click **Fit** (bottom right) to see the whole protocol. On large codebases the map opens zoomed in on
the riskiest action so its cards are readable.

## Something is wrong

[Open an issue](https://github.com/prajwalghate/sourcetruth/issues) with the command you ran and,
if you can, a small piece of code that shows it. Unfamiliar code is how most of the tool's bugs have
been found.
