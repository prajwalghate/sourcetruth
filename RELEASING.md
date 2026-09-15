# Releasing sourcetruth

- **Package:** `@prajwalghate/sourcetruth` on npm (the unscoped `sourcetruth` belongs to an unrelated
  product). The command it installs is `sourcetruth`.
- **Licence:** MIT.
- **Repository:** https://github.com/prajwalghate/sourcetruth
- **Site:** https://prajwalghate.github.io/sourcetruth/, deployed from `website/` on every push to
  `main` by `.github/workflows/pages.yml`.

## One-time setup

1. **Pages:** repository Settings → Pages → Source: **GitHub Actions**.
2. **npm:** create an npm *automation* token and add it as the repository secret `NPM_TOKEN`
   (Settings → Secrets and variables → Actions).

## Cutting a release

1. Update `version` in `package.json` and add the entry to `CHANGELOG.md`.
2. `npm test`, then `npm pack --dry-run` and check the file list (bin, src, examples, docs, licence).
3. Commit, then tag and push:

   ```bash
   git tag v0.1.0
   git push origin main v0.1.0
   ```

`.github/workflows/release.yml` then runs the tests, checks the tag matches `package.json`, publishes
to npm with provenance, creates the GitHub release, and moves the `v0` tag that
`uses: prajwalghate/sourcetruth@v0` resolves to.

To publish by hand instead: `npm login`, then `npm publish --access public`.

## Versioning

Semver. `--json` carries `schemaVersion`; bump it only when a field changes meaning or is removed,
and say so in the changelog. Map layout is deterministic — a change that moves cards on unchanged code
is a behaviour change worth a note.
