import { readFileSync } from "node:fs";
import { defineConfig } from "vitepress";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const repo = "https://github.com/prajwalghate/sourcetruth";
const base = "/sourcetruth/";

export default defineConfig({
  title: "sourcetruth",
  description: "See what Daml and Solidity contract code does — who can act, what each action changes — and what could not be traced.",
  base,
  cleanUrls: true,
  lang: "en-US",
  head: [
    ["link", { rel: "icon", type: "image/svg+xml", href: `${base}favicon.svg` }],
    ["meta", { name: "theme-color", content: "#2f5bea" }],
    ["meta", { property: "og:type", content: "website" }],
    ["meta", { property: "og:title", content: "sourcetruth" }],
    ["meta", { property: "og:description", content: "See what contract code really does — who can act, what every action changes, and what could not be traced." }],
  ],
  themeConfig: {
    logo: "/logo-mark.svg",
    nav: [
      { text: "Guide", link: "/guide/", activeMatch: "/guide/" },
      { text: "Reference", link: "/reference/cli", activeMatch: "/reference/" },
      { text: "Demo", link: "/demo" },
      {
        text: `v${pkg.version}`,
        items: [
          { text: "Changelog", link: `${repo}/blob/main/CHANGELOG.md` },
          { text: "npm package", link: "https://www.npmjs.com/package/@prajwalghate/sourcetruth" },
          { text: "Releases", link: `${repo}/releases` },
        ],
      },
    ],
    sidebar: {
      "/guide/": [
        {
          text: "Introduction",
          items: [
            { text: "What is sourcetruth?", link: "/guide/" },
            { text: "Getting started", link: "/guide/getting-started" },
            { text: "A first audit", link: "/guide/first-audit" },
          ],
        },
        {
          text: "Using the map",
          items: [
            { text: "Reading the map", link: "/guide/reading-the-map" },
            { text: "Who can act", link: "/guide/who-can-act" },
            { text: "Blind spots", link: "/guide/blind-spots" },
          ],
        },
        {
          text: "Languages",
          items: [
            { text: "Daml", link: "/guide/daml" },
            { text: "Solidity", link: "/guide/solidity" },
          ],
        },
        {
          text: "In practice",
          items: [
            { text: "In CI", link: "/guide/ci" },
            { text: "What it can't tell you", link: "/guide/limits" },
            { text: "Troubleshooting", link: "/guide/troubleshooting" },
          ],
        },
      ],
      "/reference/": [
        {
          text: "Reference",
          items: [
            { text: "Command line", link: "/reference/cli" },
            { text: "JSON model", link: "/reference/json" },
            { text: "GitHub Action", link: "/reference/action" },
          ],
        },
      ],
    },
    socialLinks: [{ icon: "github", link: repo }],
    search: { provider: "local" },
    editLink: { pattern: `${repo}/edit/main/website/:path`, text: "Edit this page on GitHub" },
    outline: { level: [2, 3] },
    footer: {
      message: "Released under the MIT License.",
      copyright: "Copyright © 2026 Prajwal Ghate",
    },
  },
});
