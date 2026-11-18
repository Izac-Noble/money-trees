# Money Trees — house rules

Money Trees helps young adults and first-time homeowners compare financial strategies
(extra mortgage payments vs. investing, shorter payoff, cheaper home, renting a room) and
see projected tradeoffs. Feature spec: Wealth Strategy Lab.

## Repo layout

- `engine/` — pure-Python calculation engine. **All financial math lives here.**
- `api/` — FastAPI. Thin layer: validate input, call the engine, return JSON. No math.
- `web/` — React + TS + Vite + Tailwind. Displays results. No financial math in the browser.

## Git & PRs

- `staging` is the integration branch and the default. Branch from it as `feature/<slug>`,
  `fix/<slug>` or `chore/<slug>`, and open PRs **into `staging`**. `main` is release only.
- Never push directly to `staging` or `main`.
- Fill in the PR template. Keep PRs small and focused on one change.
- No `Co-Authored-By` or Claude attribution lines in commits or PR descriptions.

## Quality bar

- CI (lint, type check, tests, build for all three packages) must be green before merge.
- Run the same checks locally first — see README "Checks".
- Python: ruff + `mypy --strict`, type hints everywhere. TypeScript: `strict`, no `any`.
- Every engine function gets unit tests, including edge cases (0% rate, 0 balance,
  payoff in the first month, very long horizons).

## Engine rules

- Deterministic and side-effect free: no I/O, network, clock, or randomness without a seed.
- Use `Decimal` for money; never `float` for currency amounts.
- Return the assumptions used (rates, horizons, inflation) alongside every projection.

## Product & safety rules

- Results are educational estimates, **not financial advice**. Say so in the UI wherever
  projections appear, and never label one strategy as "best".
- Show tradeoffs: don't default to fastest payoff, highest return, or most leverage.
- Never commit secrets or real user financial data. Config goes in `.env` (see `.env.example`).
- Test fixtures use made-up numbers only.
