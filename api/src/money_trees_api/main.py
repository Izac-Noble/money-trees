"""FastAPI app. Every route lives under /api.

On Vercel the web app and this API share one domain, and Vercel passes the full
path (/api/...) to the function, so routes are declared with the /api prefix.
Locally the Vite dev server proxies /api to uvicorn. The browser only ever
makes same-origin requests, so no CORS middleware is needed.
"""

import os

from fastapi import APIRouter, FastAPI

import money_trees_engine
from money_trees_api.settings import Settings

API_PREFIX = "/api"


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="Money Trees API",
        version="0.1.0",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json",
    )
    router = APIRouter(prefix=API_PREFIX)

    @router.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "app_env": settings.app_env,
            "engine_version": money_trees_engine.__version__,
        }

    app.include_router(router)
    return app


app = create_app(Settings.from_env(os.environ))
