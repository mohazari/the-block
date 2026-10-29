# The Block

Buyer-side vehicle auction prototype for the [OPENLANE coding challenge](docs/CHALLENGE.md).
Browse 200 vehicles, inspect condition and damage, and bid against live (simulated) competition.

> 🚧 Work in progress — this README is completed in the final slice.

## How to run

**Prerequisites:** Node.js ≥ 22 and [uv](https://docs.astral.sh/uv/getting-started/installation/) (manages Python 3.12 for you).

```bash
npm run setup   # installs web deps (npm) and API deps (uv)
npm run dev     # API on :8000, web on :5173 (proxied)
```

Open http://localhost:5173.

| Command         | What it does                            |
| --------------- | --------------------------------------- |
| `npm test`      | API tests (pytest) + web tests (Vitest) |
| `npm run lint`  | ruff + mypy, oxlint + tsc + prettier    |
| `npm run build` | Production web build                    |

## Repo layout

```
server/   FastAPI + SQLite auction API
web/      React + Vite buyer app
data/     vehicles.json — the provided dataset (source of truth for seeding)
docs/     Original challenge brief
```

See [DECISIONS.md](DECISIONS.md) for the reasoning behind each choice.
