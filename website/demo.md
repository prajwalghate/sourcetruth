---
layout: page
title: Live demo
---

<div class="demo-page">

# Live demo

Two small protocols ship with sourcetruth, written to show everything the map can draw. Pick an example, then walk the steps — each one moves the map beside it. Everything you see is the tool's real output.

<DemoMap :height="720" />

## Run it yourself

```bash
npm install -g @prajwalghate/sourcetruth
sourcetruth --demo -o demo.html              # the Solidity vault
sourcetruth --demo daml -o demo-daml.html    # the Daml lending protocol
```

The example source lives in [`examples/`](https://github.com/prajwalghate/sourcetruth/tree/main/examples) in the repository.

</div>

<style>
.demo-page { max-width: 1280px; margin: 0 auto; padding: 48px 24px 96px; }
@media (min-width: 768px) { .demo-page { padding: 64px 48px 112px; } }
.demo-page h1 { font-size: 34px; font-weight: 700; letter-spacing: -0.02em; margin: 0 0 8px; }
.demo-page > p { color: var(--vp-c-text-2); max-width: 70ch; margin: 0 0 20px; line-height: 1.65; }
.demo-page h2 { font-size: 22px; margin: 48px 0 12px; border-top: 1px solid var(--vp-c-divider); padding-top: 24px; }
</style>
