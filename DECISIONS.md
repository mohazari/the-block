# Decision log

A running record of the choices made while building The Block and why. Newest sections are
appended per slice; each slice ships as its own reviewed PR.

## How this was built

- **Workflow:** the work is split into slices (setup → domain → API → realtime → UI → polish).
  Each slice is built, code-reviewed, tested, committed on a branch, and merged via PR once CI is
  green. The PR history is the audit trail.
- **AI usage:** built with Claude Code as a pair. I set the product direction, the constraints, and
  the review bar; the agent did repo/data analysis, drafted code, and ran reviews. Every slice was
  reviewed before merge. Two design references were consulted:
  - [ui-ux-pro-max-skill](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) — its search
    tool classified the product as an _Auction Platform_ (bid-green / outbid-red / countdown-amber
    semantics, live-region accessibility rules). Used critically: its suggested _Playfair Display_
    body font and _dark-first_ theme were rejected (see Design below).
  - [Motion](https://github.com/motiondivision/motion) — animation library (`motion/react`).

## Slice 0 — Repo setup

| Decision                                                   | Why                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Monorepo: `server/` (FastAPI) + `web/` (Vite)**          | Both halves in one PR stream; one `npm run dev` starts everything.                                                                                                   |
| **Python + FastAPI + SQLite**                              | Pydantic validates every bid at the edge; FastAPI gives reviewers interactive docs at `/docs`; SQLite needs zero setup yet supports real transactions for bid races. |
| **uv for Python**                                          | One command installs the right Python _and_ the locked deps — reviewers don't need a pre-configured Python.                                                          |
| **npm workspaces**                                         | A single root `npm install` installs the web app; root scripts orchestrate both stacks.                                                                              |
| **Vite proxy `/api` → `:8000`**                            | Same-origin in dev: no CORS configuration, and `EventSource` (SSE) works unchanged.                                                                                  |
| **TypeScript 7 + oxlint** (current Vite template defaults) | Native-speed typecheck and lint; kept rather than swapping in older tooling. `strict` + `noUncheckedIndexedAccess` on.                                               |
| **ruff + mypy (strict) + pytest with warnings-as-errors**  | Fast lint/format, real type safety, and deprecations surface immediately (e.g. Starlette's `httpx` → `httpx2` switch was caught this way).                           |
| **CI on every PR** (GitHub Actions)                        | "Tested" is visible on GitHub, not just claimed. Actions pinned to verified release tags.                                                                            |
| **Dependency freshness policy**                            | Pin fast-moving libraries to a release ≥ ~2 weeks old (e.g. Motion `14.2.0`, not the day-old `14.7.1`) — brand-new releases have had little real-world exposure.     |
| **Original brief kept at `docs/CHALLENGE.md`**             | The root README becomes the submission README, as the brief asks.                                                                                                    |
