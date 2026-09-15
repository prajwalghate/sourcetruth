---
layout: home

hero:
  name: sourcetruth
  text: See what contract code really does
  tagline: Point it at Daml or Solidity. It maps who can act and what every action changes — and marks anything it couldn’t trace, instead of guessing.
  image:
    light: /logo-hero-light.svg
    dark: /logo-hero-dark.svg
    alt: sourcetruth
  actions:
    - theme: brand
      text: Get started
      link: /guide/getting-started
    - theme: alt
      text: Try the live demo
      link: /demo
    - theme: alt
      text: GitHub
      link: https://github.com/prajwalghate/sourcetruth

features:
  - title: Who can act
    details: Every party the code lets take an action, split into those outside the protocol and those running it. Worked out from the code — never from what things are named.
  - title: Press play on any action
    details: Pick an action and watch it happen on the map — what it archives, what it creates, what it calls — in the order the code does them.
  - title: Borrowed authority, surfaced
    details: See whose authority an action carries beyond its caller, and which contract ids the caller gets to choose. The rules auditors most often miss, drawn.
  - title: Blind spots, never guesses
    details: Every call whose target can’t be named from source is shown in amber. Nothing is dropped, nothing is invented, and the share traced is on screen.
  - title: Daml and Solidity
    details: Canton templates, choices and signatories. Solidity contracts, inheritance, libraries — and the public functions you inherit from vendored code.
  - title: One file, no server
    details: The map is a single HTML file. Open it offline, attach it to a ticket, and diff it between commits — the same code always draws the same map.
---

<div class="home-sections">

<section>
  <h2>Try it without installing</h2>
  <p class="lede">This is the real output of <code>sourcetruth --demo</code> on the example vault. Pick a step, or click around the map yourself.</p>
  <DemoMap />
</section>

<section>
  <h2>Install and run</h2>
  <p class="lede">Node 22 or newer. No dependencies.</p>

```bash
npm install -g @prajwalghate/sourcetruth

sourcetruth --demo -o demo.html               # the map above, on your machine
sourcetruth ./contracts --html -o map.html    # your code
```

</section>

<section>
  <h2>Three rules it never breaks</h2>
  <div class="rules">
    <div class="rule">
      <h3>Comments are never evidence</h3>
      <p>Every comment is stripped before a line is read. If a comment says a function is admin-only and the code says otherwise, the map shows the code.</p>
    </div>
    <div class="rule">
      <h3>Blind spots are never guessed</h3>
      <p>A call whose target can’t be named is reported with its source line. An arrow that isn’t there means “unproven”, never “nothing there”.</p>
    </div>
    <div class="rule">
      <h3>Access comes from code, not names</h3>
      <p>Who is inside the protocol is derived from signatories and checks. A function named <code>onlyOwner</code> that doesn’t check the caller is shown as open.</p>
    </div>
  </div>
</section>

<section>
  <h2>A map on every pull request</h2>
  <p class="lede">The GitHub Action uploads the map as an artifact, writes a summary on the run, and fails the build when tracing drops below your floor — the signal that code arrived the tool can’t follow.</p>

```yaml
- uses: actions/checkout@v4
  with:
    submodules: recursive
- uses: prajwalghate/sourcetruth@v0
  with:
    path: ./contracts
    min-resolution: 90
```

</section>

</div>
