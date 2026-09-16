# Releasing sourcetruth

- **Package:** `@prajwalghate/sourcetruth` on npm (the unscoped `sourcetruth` belongs to an unrelated
  product). The command it installs is `sourcetruth`.
- **Licence:** MIT.
- **Repository:** https://github.com/prajwalghate/sourcetruth
- **Site:** https://prajwalghate.github.io/sourcetruth/, deployed from `website/` on every push to
  `main` by `.github/workflows/pages.yml`.

## One-time setup

1. **Pages:** repository Settings → Pages → Source: **GitHub Actions**.
2. **npm — trusted publishing, no token.** On npmjs.com: the package → **Settings** →
   **Trusted publishing** → **GitHub Actions**, then fill in:

   | Field | Value |
   |---|---|
   | Organization or user | `prajwalghate` |
   | Repository | `sourcetruth` |
   | Workflow filename | `release.yml` (the file name only, not the path) |
   | Environment name | *(leave empty)* |

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

**If the publish step fails,** fix the cause and use *Re-run jobs* on that run — it reruns the same
tag. `ENEEDAUTH` means npm has no trusted publisher matching this repository and workflow file.

To publish by hand instead: `npm login`, then `npm publish --access public` (asks for your 2FA code;
a package published from a laptop has no provenance).

## Versioning

Semver. `--json` carries `schemaVersion`; bump it only when a field changes meaning or is removed,
and say so in the changelog. Map layout is deterministic — a change that moves cards on unchanged code
is a behaviour change worth a note.
