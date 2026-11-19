# Money Trees

Helps young adults and first-time homeowners compare money decisions (pay down the mortgage, invest, rent a room…) and see the long-run tradeoffs.

| Package | What it is |
| --- | --- |
| `engine/` | Pure-Python calculation engine (`money_trees_engine`) |
| `api/` | FastAPI app that serves the engine over HTTP at `/api/*` |
| `web/` | React + TypeScript + Vite + Tailwind front end |

## Local setup

Requires Python 3.11+ (Vercel and CI use 3.12, from `api/.python-version`) and Node 24 (`nvm use`).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e "engine[dev]" -e "api[dev]"
cd web && npm install
```

Run the API and web app in two terminals:

```bash
uvicorn money_trees_api.main:app --reload
```

```bash
cd web && npm run dev
```

Open http://localhost:5173. The page calls `/api/health`, and the Vite dev server proxies `/api/*`
to uvicorn on port 8000, so the browser uses the same relative paths locally as on Vercel.

## Checks (same as CI)

```bash
cd engine && ruff check . && ruff format --check . && mypy src tests && pytest
cd api && uv lock --check && ruff check . && ruff format --check . && mypy src tests index.py && pytest
cd web && npm run lint && npm run typecheck && npm test && npm run build
```

## API

FastAPI under `/api`. It validates input, calls the engine and returns JSON. It does no
math and stores nothing. Request and response bodies are never logged; only method,
path, status and duration are. Interactive docs are at `/api/docs`.

| Method | Path | What it returns |
| --- | --- | --- |
| GET | `/api/health` | Status, `APP_ENV`, engine version |
| GET | `/api/meta` | Categories with suggested terms, input limits, engine version, disclaimer |
| POST | `/api/amortization` | One loan's summary and schedule (Spec 1) |
| POST | `/api/debts` | Each debt plus the combined picture (Spec 2) |
| POST | `/api/strategies` | One payoff strategy: avalanche, snowball or custom (Spec 3) |
| POST | `/api/strategies/compare` | Avalanche and snowball side by side (Spec 3) |

- Money and rates are **strings** (`"200000"`, `"0.06"`), never JSON numbers. Money takes up
  to 2 decimal places, rates up to 6. Months and counts are integers.
- Every money value in a response has exactly 2 decimal places (`"1199.10"`).
- Every POST response includes `engine_version`.
- Errors are `{"errors": [{"field": "debts[1].annual_rate", "message": "..."}]}`, listing every
  invalid field: 400 for malformed JSON, 413 over 100 KB, 422 for invalid input, and a
  generic 500 with no details.

## Deploying

Everything deploys as **one Vercel project** using
[Vercel Services](https://vercel.com/docs/services), configured in
[`vercel.json`](vercel.json):

| Service | Root | Serves | How |
| --- | --- | --- | --- |
| `web` | `web/` | every path except `/api/*` | Vite static build |
| `api` | `api/` | `/api/*` | FastAPI as one Python Vercel Function (entrypoint `api/index.py`) |

The web app and the API share one domain, so the browser calls the API with
relative `/api/...` paths. There is no API URL to configure and no CORS. Vercel
passes the full path (for example `/api/health`) to FastAPI, which is why every
route is declared under the `/api` prefix.

| Git branch | Vercel environment |
| --- | --- |
| `main` | Production |
| `staging` and PR branches | Preview |

### Vercel project settings

- **Root Directory:** leave empty (repo root), where `vercel.json` lives.
- **Framework Preset / Build Command / Output Directory:** leave on defaults.
  Each service's build is set in `vercel.json`.
- **Node.js version:** pinned to `24.x` by `engines.node` in
  [`web/package.json`](web/package.json). Vercel no longer supports Node 20.
- **Python version:** `3.12`, from [`api/.python-version`](api/.python-version).

### How the engine gets into the API function

`api/pyproject.toml` depends on `money-trees-engine`, and
`[tool.uv.sources]` points that dependency at `../engine`. Vercel installs the
API service with uv from [`api/uv.lock`](api/uv.lock), so the engine is built
from the repo and bundled into the function like any other package. After
changing dependencies in `api/` or `engine/`, run `uv lock` in `api/` and commit
`uv.lock`. CI fails if it's out of date.

### Environment variables

Set these in **Vercel → Project → Settings → Environment Variables**. One
project serves both web and API, so each variable is shared by both services.

| Variable | Purpose | Preview (staging + PRs) | Production |
| --- | --- | --- | --- |
| `APP_ENV` | Names the environment. The API returns it from `GET /api/health`. The web build adds a noindex robots tag unless it is exactly `production`. Defaults to `development` when unset. | `staging` | `production` |
| `API_PROXY_TARGET` | Local dev only: where `npm run dev` proxies `/api`. Defaults to `http://127.0.0.1:8000`. Not set on Vercel. | — | — |

`VITE_API_URL` and `ALLOWED_ORIGINS` are no longer used. Delete them from any
Vercel or Render settings where they were added.
