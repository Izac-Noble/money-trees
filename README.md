# Money Trees

Helps young adults and first-time homeowners compare money decisions (pay down the mortgage, invest, rent a room…) and see the long-run tradeoffs.

| Package | What it is |
| --- | --- |
| `engine/` | Pure-Python calculation engine (`money_trees_engine`) |
| `api/` | FastAPI app that serves the engine over HTTP |
| `web/` | React + TypeScript + Vite + Tailwind front end |

## Local setup

Requires Python 3.11+ and Node 20 (`nvm use`).

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -e "engine[dev]" -e "api[dev]"
cd web && npm install
```

Run the API and web app in two terminals:

```bash
uvicorn money_trees_api.main:app --reload --app-dir api/src
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
