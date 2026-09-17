# sourcetruth

[![npm](https://img.shields.io/npm/v/@prajwalghate/sourcetruth)](https://www.npmjs.com/package/@prajwalghate/sourcetruth)
[![test](https://github.com/prajwalghate/sourcetruth/actions/workflows/test.yml/badge.svg)](https://github.com/prajwalghate/sourcetruth/actions/workflows/test.yml)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

**[Documentation](https://prajwalghate.github.io/sourcetruth/)** · **[Live demo](https://prajwalghate.github.io/sourcetruth/demo)** · [Guide](GUIDE.md)

See what smart-contract code **does** — who can act, and what each action changes — straight from
the source. And see, just as plainly, what it **could not trace**.

Works on **Daml** (Canton) and **Solidity**. One command, one self-contained HTML file, no server.

```bash
sourcetruth --demo -o demo.html
sourcetruth ./contracts --html -o map.html
```

The first maps a bundled example; the second, your own code.

## What you get

A map of the protocol you can click through:

- **Who can act** — every party the code lets take an action, split into those *outside* the
  protocol and those running it. Worked out from the code, not from what things are called.
- **What an action does** — pick one and press **Play**: what it archives, what it creates, what it
  calls, in the order the code does them, and whose authority it carries beyond the caller's own.
- **Each contract's life** — what makes it, what replaces it, what ends it.
- **Blind spots** — every call whose target can't be named from source is shown in amber. The tool
  never guesses one and never drops one.

Comments are stripped before anything is read. If a comment says a function is admin-only and the
code says otherwise, the map shows the code.

## Install

Node 22 or newer. No dependencies.

```bash
npm install -g @prajwalghate/sourcetruth
sourcetruth --version
```

## Use it

| Command | Shows |
|---|---|
| `sourcetruth ./contracts` | A summary and the blind spots, in the terminal |
| `sourcetruth ./contracts --html -o map.html` | The interactive map |
| `sourcetruth ./contracts --surface` | Actions one party can take alone |
| `sourcetruth ./contracts --json` | The full model, for your own tooling |
| `sourcetruth ./contracts --min-resolution 90` | For CI: fails if too little can be traced |

Replace `./contracts` with the folder that holds your Daml or Solidity source.

**[GUIDE.md](GUIDE.md)** walks through a first audit, reading the map, every option, CI, and what
the tool cannot tell you.

## In CI

```yaml
- uses: prajwalghate/sourcetruth@v0
  with:
    path: ./contracts
    min-resolution: 90
```

The map is uploaded as a workflow artifact and a summary is written to the run.

## Contributing

Bug reports with a small piece of code that shows the problem are the most useful thing you can send
— unfamiliar code is how most of this tool's bugs have been found. See [CONTRIBUTING.md](CONTRIBUTING.md).

## What it is not

Not a bug finder. It has no vulnerability patterns and makes no judgement about whether code is
wrong. It draws what the code does so a person can decide — and it stores no findings.

## License

[MIT](LICENSE)
