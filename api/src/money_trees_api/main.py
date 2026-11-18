import os

from fastapi import FastAPI

import money_trees_engine

app = FastAPI(title="Money Trees API", version="0.1.0")


@app.get("/health")
def health() -> dict[str, str]:
    return {
        "status": "ok",
        "env": os.getenv("MONEY_TREES_ENV", "development"),
        "engine_version": money_trees_engine.__version__,
    }
