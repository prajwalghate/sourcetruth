// The docs are read by people who paste. On macOS the default shell is zsh, and an interactive zsh
// does not treat `#` as a comment: `open demo.html  # or double-click it` opens four files that don't
// exist. So a shell block in the docs holds commands only — the explanation goes in the prose.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKIP = new Set(["node_modules", ".vitepress", ".git", "test"]);
const SHELL = /^(bash|sh|shell|zsh)$/;

function markdownFiles(dir, out = []) {
  for (const d of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(d.name)) continue;
    const p = path.join(dir, d.name);
    if (d.isDirectory()) markdownFiles(p, out);
    else if (d.name.endsWith(".md")) out.push(p);
  }
  return out;
}

/** Fenced blocks as { lang, lines: [{ n, text }] }. */
export function fencedBlocks(markdown) {
  const blocks = [];
  let open = null;
  markdown.split("\n").forEach((line, i) => {
    const fence = line.match(/^\s*(`{3,}|~{3,})\s*([\w-]*)\s*$/);
    if (!open && fence) {
      open = { char: fence[1][0], len: fence[1].length, lang: fence[2].toLowerCase(), lines: [] };
    } else if (open && fence && !fence[2] && fence[1][0] === open.char && fence[1].length >= open.len) {
      blocks.push(open);
      open = null;
    } else if (open) {
      open.lines.push({ n: i + 1, text: line });
    }
  });
  return blocks;
}

const unquoted = (line) => line.replace(/'[^']*'|"(?:[^"\\]|\\.)*"/g, "''");

/** A word that starts with `#`, outside quotes: a comment to bash, a stray argument to zsh. */
export const hasComment = (line) => /(^|\s)#/.test(unquoted(line));

/** `<dir>` is a redirection to a shell, not a placeholder: it fails with "no such file: dir". */
export const hasPlaceholder = (line) => /<[\w-]+>/.test(unquoted(line));

test("the scanner finds a comment wherever a shell would", () => {
  assert.equal(hasComment("open demo.html          # or double-click it"), true);
  assert.equal(hasComment("# a whole-line note"), true);
  assert.equal(hasComment("sourcetruth ./src --json | jq -r '.entries[] | \"# \\(.name)\"'"), false);
  assert.equal(hasComment("open map.html#e-Vault-takeFee"), false);
  assert.equal(hasPlaceholder("sourcetruth <dir> --html"), true);
  assert.equal(hasPlaceholder("sourcetruth ./src --json | jq '.x < 3'"), false);
  const blocks = fencedBlocks("text\n```bash\nls  # list\n```\n```yaml\nkey: 1 # fine in YAML\n```\n");
  assert.deepEqual(blocks.map((b) => [b.lang, b.lines.length]), [["bash", 1], ["yaml", 1]]);
});

test("no shell block in the docs carries a comment or a <placeholder>, so every block pastes cleanly", () => {
  const offenders = [];
  for (const file of markdownFiles(ROOT)) {
    for (const block of fencedBlocks(fs.readFileSync(file, "utf8"))) {
      if (!SHELL.test(block.lang)) continue;
      for (const { n, text } of block.lines) {
        if (hasComment(text) || hasPlaceholder(text)) offenders.push(`${path.relative(ROOT, file)}:${n}: ${text.trim()}`);
      }
    }
  }
  assert.deepEqual(offenders, [], "move these notes out of the code block and into the prose");
});
