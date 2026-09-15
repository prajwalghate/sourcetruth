import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const BIN = path.join(import.meta.dirname, "..", "bin", "sourcetruth.mjs");
const FIX = path.join(import.meta.dirname, "fixtures");
const run = (args, opts = {}) =>
  execFileSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...opts });

/**
 * A corpus whose --json output comfortably exceeds the 64 KB pipe buffer.
 *
 * The small fixture directory CANNOT catch the truncation bug: its JSON is a few KB, well under the
 * buffer, so the output arrives whole whether or not the process exits early. A test that passes
 * because the payload is too small to trigger the fault is worse than no test — it reports the bug
 * as fixed. Verified by mutation: with `process.exit()` restored, the fixture-sized test stayed
 * green and this one fails.
 */
function bigCorpus() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sourcetruth-big-"));
  for (let i = 0; i < 60; i++) {
    fs.writeFileSync(path.join(dir, `M${i}.daml`), `
module M${i} where

template T${i}
  with
    owner : Party
    nextCid : ContractId T${i}
  where
    signatory owner

    choice Step${i} : ContractId T${i}
      with other : ContractId T${i}
      controller owner
      do
        _a <- fetch nextCid
        _b <- fetch other
        create this with owner

    choice End${i} : ()
      controller owner
      do
        archive nextCid
        pure ()
`);
  }
  return dir;
}

test("--json emits COMPLETE json through a pipe, not a truncated prefix", () => {
  // The regression this exists for: `process.exit()` after `console.log` killed the process before
  // stdout drained, so piped output stopped at the 64 KB pipe buffer — valid-looking for 65282
  // bytes, then a string ending mid-token. It was invisible in a terminal, where stdout is
  // synchronous. execFileSync captures through a pipe, which is what makes this test meaningful.
  const dir = bigCorpus();
  try {
    const out = run([dir, "--json"], { maxBuffer: 64 * 1024 * 1024 });
    assert.ok(out.length > 65536, `corpus too small to exercise the bug (${out.length} bytes)`);
    const m = JSON.parse(out);                     // throws on truncation
    assert.equal(m.stats.units, m.units.length);
    assert.ok(out.trimEnd().endsWith("}"), "output does not end with a closing brace");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("each mode returns ONLY its own output — no bleed into the summary", () => {
  for (const mode of ["--holes", "--graph", "--surface", "--json"]) {
    const out = run([FIX, mode]);
    assert.ok(!out.includes("resolution   "), `${mode} leaked the summary`);
  }
});

test("exit codes: help 0, no args 2, unknown language 2", () => {
  assert.equal(run(["--help"]).includes("sourcetruth <dir>"), true);
  for (const [args, code] of [[[], 2], [[FIX, "--lang", "cobol"], 2]]) {
    let got = 0;
    try { run(args, { stdio: "pipe" }); } catch (e) { got = e.status; }
    assert.equal(got, code, `${args.join(" ") || "(no args)"} should exit ${code}`);
  }
});

test("--min-resolution is a floor, and only fails BELOW it", () => {
  run([FIX, "--min-resolution", "0"]);            // passes: throws on non-zero exit
  let failed = false;
  try { run([FIX, "--min-resolution", "101"], { stdio: "pipe" }); } catch { failed = true; }
  assert.equal(failed, true, "an impossible floor should fail");
});
