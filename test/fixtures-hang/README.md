Deliberately kept OUT of `test/fixtures/`.

Five tests call `daml.parse(FIX)` on the whole fixtures directory at module load. A fixture whose
purpose is to be non-terminating under a regression would therefore hang those tests in-process,
before the test written to catch it ever runs — so the suite would hang rather than fail, and a
hanging CI job is not read as a bug report.

The hang regression parses this file in a CHILD PROCESS with a hard kill. See
`test/parse.test.mjs` → "a body of stripped-comment whitespace does not hang the resolver".
