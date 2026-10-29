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

## Slice 1 — Auction domain & data

| Decision                                                                                                                                           | Why                                                                                                                                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pure rule module** (`server/app/domain/`) with `now` passed in                                                                                   | Every auction rule is deterministic and unit-tested without a DB or sleeping; the API, the bid transaction and the simulator share one implementation.                                               |
| **Clock normalization:** keep the dataset's relative schedule, shift it so the first auction closes 20 min after seeding; **4-day timed auctions** | Literal dates are all in the past. Simulated 48/72/96/120h durations against the data: 96h gives 112 live / 88 upcoming, and a countdown hits zero early in any demo.                                |
| **Pre-bids on upcoming auctions**                                                                                                                  | 43 vehicles that land in "upcoming" already carry bids in the dataset. Rather than discard data, model what wholesale lanes do: proxy bids before the car runs.                                      |
| **Status is derived, never stored**                                                                                                                | `upcoming/live/ended` come from `starts_at`/`ends_at` vs. the clock — cannot go stale, no cron job to flip states.                                                                                   |
| **Increment ladder** $100 → $250 → $500 → $1,000 at $5k / $15k / $50k                                                                              | Meaningful steps on a $3k sedan and a $60k truck alike.                                                                                                                                              |
| **Reserve amount is server-only**                                                                                                                  | Buyers see _met / not met / no reserve_, as on real platforms; the number never leaves the API.                                                                                                      |
| **Soft close (2 min)**                                                                                                                             | A late bid re-arms the window so rivals can respond; sniping stops paying.                                                                                                                           |
| **Bid guards:** no raising your own winning bid; max single jump = 3× the minimum                                                                  | The first only costs the buyer money; the second catches an extra-zero typo on a five-figure bid.                                                                                                    |
| **Damage severity** (cosmetic / mechanical / structural) by keyword, most severe first                                                             | Buyers price a scratch, budget a transmission, and walk away from flood/frame. Verified against all 30 distinct notes in the data.                                                                   |
| **Synthesized bid history** for the 88 vehicles with bids (fixed RNG seed)                                                                         | Data has `bid_count` but no bids; "16 bids" next to an empty list would undermine trust. Ladders end exactly at the dataset's `current_bid`.                                                         |
| **Concurrency: `BEGIN IMMEDIATE` for write sessions**                                                                                              | The bid path reads the price then writes; taking SQLite's write lock up front prevents two bidders both "winning" at the same price. Proven by a two-thread test. (Postgres: `SELECT … FOR UPDATE`.) |
| **Integers for money, UTC-aware datetimes everywhere**                                                                                             | No float rounding on prices; a custom column type rejects naive datetimes.                                                                                                                           |
| **Auto-reseed when every auction has closed**                                                                                                      | A reviewer cloning next week still gets a live marketplace. `npm run reset-db` forces it.                                                                                                            |
