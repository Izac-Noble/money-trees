# Money Trees

Helps young adults and first-time homeowners compare money decisions (pay down the mortgage, invest, rent a room…) and see the long-run tradeoffs.

| Package | What it is |
| --- | --- |
| `engine/` | Pure-Python calculation engine (`money_trees_engine`) |
| `api/` | FastAPI app that serves the engine over HTTP |
| `web/` | React + TypeScript + Vite + Tailwind front end |

## Local setup

Requires Python 3.11+ (deploys use the version in `.python-version`) and Node 20 (`nvm use`).

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

Open http://localhost:5173. The page calls `/health` through the Vite proxy.

## Checks (same as CI)

```bash
cd engine && ruff check . && ruff format --check . && mypy src tests && pytest
cd api && ruff check . && ruff format --check . && mypy src tests && pytest
cd web && npm run lint && npm run typecheck && npm test && npm run build
```

## Deploying

| Part | Host | Branch → environment |
| --- | --- | --- |
| API | Render (Python web service) | `staging` → staging service, `main` → production service |
| Web | Vercel | `staging` and PRs → Preview, `main` → Production |

Real URLs and secrets live only in the Render and Vercel dashboards. Never commit them.

### API on Render

Create one web service per environment with these settings:

- **Runtime:** Python 3
- **Root Directory:** leave empty (repo root), so the build can see `engine/`
- **Python version:** pinned by [`.python-version`](.python-version) (`3.12.16`)
- **Build Command:**

  ```bash
  pip install --upgrade pip && pip install ./engine ./api
  ```

- **Start Command:**

  ```bash
  uvicorn money_trees_api.main:app --host 0.0.0.0 --port $PORT
  ```

- **Health Check Path:** `/health`

The build installs the local engine package first, then the API that depends on it.
If `ALLOWED_ORIGINS` contains `*` or a value without `http://` / `https://`, the
service fails to start on purpose.

### Web on Vercel

- **Root Directory:** `web`
- **Framework Preset:** Vite (build `npm run build`, output `dist`)
- **Node version:** pinned by `engines.node` (`20.x`) in [`web/package.json`](web/package.json)

Every build that isn't production gets `<meta name="robots" content="noindex, nofollow">`.
Only a build with `APP_ENV=production` is indexable.

### Environment variables

| Variable | Purpose | Where it's set | Staging value | Production value |
| --- | --- | --- | --- | --- |
| `APP_ENV` (API) | Names the environment. Returned by `GET /health`. Defaults to `development`. | Render, each service | `staging` | `production` |
| `ALLOWED_ORIGINS` | Comma-separated browser origins allowed by CORS. `*` is rejected. Unset means `http://localhost:5173` only. | Render, each service | the staging/preview web URL(s) | the production web URL |
| `PORT` | Port uvicorn listens on. | Render sets it automatically. Don't set it yourself. | — | — |
| `VITE_API_URL` | Base URL the browser calls for the API. Baked in at build time. | Vercel → Preview / Production | staging API URL | production API URL |
| `APP_ENV` (web) | Build-time switch: anything but `production` adds the noindex tag. | Vercel → Preview / Production | `staging` | `production` |
| `VITE_API_PROXY_TARGET` | Where `npm run dev` proxies `/health`. | Local only (`.env.example`) | — | — |

Note that Vercel preview deployments each get their own URL. If you open a
per-PR preview instead of the stable staging URL, its origin must be in the
staging API's `ALLOWED_ORIGINS` or the browser will block the call.
