# What it can't tell you

sourcetruth is honest about its edges. It won't tell you:

- **Whether anything is a bug.** It draws what the code does; you judge it.
- **Runtime facts** — which contract id a caller will actually pass, who holds a role, what a proxy
  currently points at, what a price is.
- **Which branch runs.** An action that archives a contract and creates one is shown as possibly
  replacing it *and* possibly ending it.
- **Arithmetic** — overflow, rounding and decimals are out of scope.
- **Inside a blind spot.** A `delegatecall` to a caller's address or an assembly `call` is shown
  and named, never followed.
- **Code that isn't on disk.** Missing imports are reported, and the functions that depend on them
  are marked. Nothing is guessed.
- **What a comment claims.** Comments are stripped before anything is read.
