import os

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import money_trees_engine
from money_trees_api.settings import Settings


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(title="Money Trees API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(settings.allowed_origins),
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )

    @app.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "app_env": settings.app_env,
            "engine_version": money_trees_engine.__version__,
        }

    return app


app = create_app(Settings.from_env(os.environ))
