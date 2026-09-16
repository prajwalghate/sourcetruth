# Releasing sourcetruth

- **Package:** `@prajwalghate/sourcetruth` on npm (the unscoped `sourcetruth` belongs to an unrelated
  product). The command it installs is `sourcetruth`.
- **Licence:** MIT.
- **Repository:** https://github.com/prajwalghate/sourcetruth
- **Site:** https://prajwalghate.github.io/sourcetruth/, deployed from `website/` on every push to
  `main` by `.github/workflows/pages.yml`.

## One-time setup

1. **Pages:** repository Settings → Pages → Source: **GitHub Actions**.
2. **npm — trusted publishing, no token.** Signed in on npmjs.com, open the package's settings
   (https://www.npmjs.com/package/@prajwalghate/sourcetruth/access), find **Trusted Publisher**,
   click **GitHub Actions**, then fill in:

   | Field | Value |
   |---|---|
   | Organization or user | `prajwalghate` |
   | Repository | `sourcetruth` |
   | Workflow filename | `release.yml` (the file name only, not the path) |
   | Environment name | *(leave empty)* |
   | Allowed actions | tick **npm publish** — publishers added after 2026-09-03 are otherwise limited to `npm stage publish` |

   Nothing is set on GitHub for this: the workflow's `id-token: write` permission is all it needs.

   npm then accepts publishes from that workflow alone, with a short-lived token it issues per run,
   and adds provenance. The release job runs on Node 24 because this needs npm 11.5.1 or newer.
3. **npm — then refuse tokens.** Same settings page → **Publishing access** → *Require two-factor
   authentication and disallow tokens*. Trusted publishing keeps working; a leaked token can't
   publish. Delete any `NPM_TOKEN` repository secret and any publish tokens on npmjs.com.

Trusted publishing can only be set up for a package that already exists, so 0.1.0 was published
with a granular token that had *bypass 2FA* enabled (without it npm answers `E403 … Two-factor
authentication or granular access token with bypass 2fa enabled is required`). npm is withdrawing
publish rights from bypass-2FA tokens, so don't go back to that.

## Cutting a release

1. Update `version` in `package.json`, and turn `## Unreleased` in `CHANGELOG.md` into the version
   and date.
2. `npm test`, then `npm pack --dry-run` and check the file list (bin, src, examples, docs, licence).
3. Commit, push `main`, and wait for the `test` workflow to pass. Then tag and push the tag:

   ```bash
   git tag -a v0.1.1 -m "sourcetruth 0.1.1"
   git push origin v0.1.1
   ```

`.github/workflows/release.yml` then checks npm can publish through OIDC, runs the tests, checks the
tag matches `package.json`, publishes to npm with provenance, creates the GitHub release, and moves
the `v0` tag that `uses: prajwalghate/sourcetruth@v0` resolves to.

**If the publish step fails,** its annotation on the run page says why — npm prints the
trusted-publishing reason only to its debug log, and the step copies it out. Fix the cause and use
*Re-run jobs* on that run; it reruns the same tag. `ENEEDAUTH` or `E403`: check the trusted publisher
on npmjs.com — the repository, the workflow file name, and that **npm publish** is an allowed action.
If the workflow itself had to change, nothing was published, so delete the tag, tag the fixed commit
with the same version and push it again.

*Staged publishing* is the stricter alternative: the workflow runs `npm stage publish` (npm 11.15.0 or
newer) and nothing goes live until a maintainer approves it with 2FA on npmjs.com.

To publish by hand instead: `npm login`, then `npm publish --access public` (asks for your 2FA code;
a package published from a laptop has no provenance).

## Versioning

Semver. `--json` carries `schemaVersion`; bump it only when a field changes meaning or is removed,
and say so in the changelog. Map layout is deterministic — a change that moves cards on unchanged code
is a behaviour change worth a note.
