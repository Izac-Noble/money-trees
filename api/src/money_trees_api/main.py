"""FastAPI app. Every route lives under /api.

On Vercel the web app and this API share one domain, and Vercel passes the full
path (/api/...) to the function, so routes are declared with the /api prefix.
Locally the Vite dev server proxies /api to uvicorn. The browser only ever
makes same-origin requests, so no CORS middleware is needed.

This layer validates input, calls the engine and formats the result. It does no
math, stores nothing, and never logs request or response bodies: they hold
people's real financial numbers. Only method, path, status and duration are logged.
"""

from __future__ import annotations

import json
import logging
import os
import time
from collections.abc import Awaitable, Callable
from typing import Any

from fastapi import APIRouter, FastAPI, Request, Response
from fastapi.responses import JSONResponse

import money_trees_engine
from money_trees_api import parsing, serialize
from money_trees_api.parsing import FieldError, InvalidInput
from money_trees_api.settings import Settings
from money_trees_engine.amortization import (
    MAX_TERM_MONTHS,
    LoanInputError,
    LoanInputTypeError,
    amortize,
)
from money_trees_engine.debts import (
    MAX_DEBTS,
    MAX_NAME_LENGTH,
    SUGGESTED_TERM_MONTHS,
    DebtInputError,
    analyze_debts,
)
from money_trees_engine.strategies import Strategy, compare_strategies, run_strategy

API_PREFIX = "/api"
MAX_BODY_BYTES = 100 * 1024
DISCLAIMER = "Estimates for learning and planning, not financial advice."

logger = logging.getLogger("money_trees_api")


class _HTTPProblem(Exception):
    def __init__(self, status: int, errors: list[FieldError]) -> None:
        super().__init__(status)
        self.status = status
        self.errors = errors


def _error_response(status: int, errors: list[FieldError]) -> JSONResponse:
    return JSONResponse(
        status_code=status,
        content={"errors": [{"field": e.field, "message": e.message} for e in errors]},
    )


def _reject_constant(name: str) -> None:
    raise ValueError(f"invalid JSON constant {name}")


async def _read_json(request: Request) -> object:
    declared = request.headers.get("content-length")
    too_big = _HTTPProblem(413, [FieldError(None, "Request is too large (limit 100 KB).")])
    if declared is not None and declared.isdigit() and int(declared) > MAX_BODY_BYTES:
        raise too_big
    body = bytearray()
    async for chunk in request.stream():
        body.extend(chunk)
        if len(body) > MAX_BODY_BYTES:
            raise too_big
    try:
        return json.loads(body, parse_constant=_reject_constant)
    except (ValueError, UnicodeDecodeError):
        raise _HTTPProblem(400, [FieldError(None, "Request body is not valid JSON.")]) from None


def _engine_error(exc: Exception, debt_ids: list[str] | None = None) -> InvalidInput:
    """Backstop: report an engine validation error with an API field path."""
    if isinstance(exc, DebtInputError):
        field = exc.field
        if exc.debt_id is not None and debt_ids and exc.debt_id in debt_ids:
            field = f"debts[{debt_ids.index(exc.debt_id)}].{exc.field}"
        return InvalidInput([FieldError(field, "This value isn't valid.")])
    if isinstance(exc, LoanInputError | LoanInputTypeError):
        return InvalidInput([FieldError(exc.field, "This value isn't valid.")])
    raise exc


def _with_version(payload: dict[str, Any]) -> dict[str, Any]:
    return {"engine_version": money_trees_engine.__version__, **payload}


def create_app(settings: Settings) -> FastAPI:
    app = FastAPI(
        title="Money Trees API",
        version="0.1.0",
        docs_url=f"{API_PREFIX}/docs",
        redoc_url=None,
        openapi_url=f"{API_PREFIX}/openapi.json",
    )

    @app.middleware("http")
    async def errors_and_access_log(
        request: Request, call_next: Callable[[Request], Awaitable[Response]]
    ) -> Response:
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except _HTTPProblem as problem:
            response = _error_response(problem.status, problem.errors)
        except InvalidInput as invalid:
            response = _error_response(422, list(invalid.errors))
        except Exception as exc:  # noqa: BLE001 - last-resort handler
            # Type only: messages and tracebacks can echo the user's numbers.
            logger.error(
                "unhandled %s on %s %s", type(exc).__name__, request.method, request.url.path
            )
            response = _error_response(
                500, [FieldError(None, "Something went wrong. Please try again.")]
            )
        elapsed_ms = (time.perf_counter() - started) * 1000
        logger.info(
            "%s %s %d %.1fms", request.method, request.url.path, response.status_code, elapsed_ms
        )
        return response

    router = APIRouter(prefix=API_PREFIX)

    @router.get("/health")
    def health() -> dict[str, str]:
        return {
            "status": "ok",
            "app_env": settings.app_env,
            "engine_version": money_trees_engine.__version__,
        }

    @router.get("/meta")
    def meta() -> dict[str, Any]:
        return {
            "engine_version": money_trees_engine.__version__,
            "disclaimer": DISCLAIMER,
            "categories": [
                {"value": c.value, "suggested_term_months": term}
                for c, term in SUGGESTED_TERM_MONTHS.items()
            ],
            "strategies": [s.value for s in Strategy],
            "limits": {
                "max_debts": MAX_DEBTS,
                "max_name_length": MAX_NAME_LENGTH,
                "min_term_months": 1,
                "max_term_months": MAX_TERM_MONTHS,
                "money_decimal_places": 2,
                "rate_decimal_places": 6,
                "max_body_bytes": MAX_BODY_BYTES,
            },
        }

    @router.post("/amortization")
    async def amortization(request: Request) -> dict[str, Any]:
        loan = parsing.parse_amortization(await _read_json(request))
        try:
            result = amortize(
                loan.principal,
                loan.annual_rate,
                loan.term_months,
                loan.extra_monthly,
                loan.lump_sums,
            )
        except (LoanInputError, LoanInputTypeError) as exc:
            raise _engine_error(exc) from None
        return _with_version(serialize.amortization(result))

    @router.post("/debts")
    async def debts(request: Request) -> dict[str, Any]:
        debt_list = parsing.parse_debts(await _read_json(request))
        try:
            result = analyze_debts(debt_list)
        except DebtInputError as exc:
            raise _engine_error(exc, [d.id for d in debt_list]) from None
        return _with_version(serialize.debts(result))

    @router.post("/strategies")
    async def strategies(request: Request) -> dict[str, Any]:
        data = parsing.parse_strategy(await _read_json(request))
        try:
            result = run_strategy(data.debts, data.extra_monthly, data.strategy, data.custom_order)
        except DebtInputError as exc:
            raise _engine_error(exc, [d.id for d in data.debts]) from None
        return _with_version(serialize.strategy(result))

    @router.post("/strategies/compare")
    async def strategies_compare(request: Request) -> dict[str, Any]:
        data = parsing.parse_compare(await _read_json(request))
        try:
            result = compare_strategies(data.debts, data.extra_monthly)
        except DebtInputError as exc:
            raise _engine_error(exc, [d.id for d in data.debts]) from None
        return _with_version(serialize.comparison(result))

    app.include_router(router)
    return app


app = create_app(Settings.from_env(os.environ))
