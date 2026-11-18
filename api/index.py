"""Vercel entrypoint: exposes the FastAPI instance as `app`."""

from money_trees_api.main import app

__all__ = ["app"]
