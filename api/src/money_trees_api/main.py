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
from money_trees_api import household_parsing, parsing, serialize
from money_trees_api.parsing import FieldError, InvalidInput
from money_trees_api.settings import Settings
from money_trees_engine.amortization import (
    MAX_TERM_MONTHS,
    TOO_LONG_MESSAGE,
    LoanInputError,
    LoanInputTypeError,
    PaymentMode,
    PaymentTooSmallError,
    amortize,
    amortize_payment,
)
from money_trees_engine.debts import (
    CATEGORIES,
    MAX_DEBTS,
    MAX_NAME_LENGTH,
    Debt,
    DebtInputError,
    analyze_debts,
    notes_for_category,
)
from money_trees_engine.household import (
    ASSET_TYPES,
    EXPENSE_CATEGORIES,
    FREQUENCIES,
    GROUP_LABELS,
    HouseholdInputError,
    analyze_household,
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
        content={
            "errors": [{"field": e.field, "message": e.message, **dict(e.details)} for e in errors]
        },
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


TOO_SMALL_MESSAGE = (
    "This payment doesn't cover the monthly interest, so the balance would never go down."
)


def _payment_error(exc: LoanInputError, field: str) -> FieldError | None:
    """Spec 3b payment errors, which only the engine can detect, in plain English."""
    if isinstance(exc, PaymentTooSmallError):
        return FieldError(
            field, TOO_SMALL_MESSAGE, (("min_interest", serialize.money(exc.min_interest)),)
        )
    if exc.field == "monthly_payment" and str(exc) == TOO_LONG_MESSAGE:
        return FieldError(field, TOO_LONG_MESSAGE)
    return None


def _engine_error(exc: Exception, debt_ids: list[str] | None = None) -> InvalidInput:
    """Report an engine validation error with an API field path."""
    if isinstance(exc, DebtInputError):
        field = exc.field
        if exc.debt_id is not None and debt_ids and exc.debt_id in debt_ids:
            field = f"debts[{debt_ids.index(exc.debt_id)}].{exc.field}"
        cause = exc.__cause__
        if isinstance(cause, LoanInputError):
            known = _payment_error(cause, field)
            if known:
                return InvalidInput([known])
        return InvalidInput([FieldError(field, "This value isn't valid.")])
    if isinstance(exc, LoanInputError):
        known = _payment_error(exc, exc.field)
        if known:
            return InvalidInput([known])
    if isinstance(exc, LoanInputError | LoanInputTypeError):
        return InvalidInput([FieldError(exc.field, "This value isn't valid.")])
    raise exc


def _check_payments(debts: list[Debt]) -> None:
    """Find every fixed_payment debt whose payment can't work, not just the first.

    Each check is an engine call; the API itself does no math.
    """
    errors: list[FieldError] = []
    for i, debt in enumerate(debts):
        if debt.payment_mode != PaymentMode.FIXED_PAYMENT or debt.monthly_payment is None:
            continue
        try:
            amortize_payment(debt.principal, debt.annual_rate, debt.monthly_payment)
        except LoanInputError as exc:
            known = _payment_error(exc, f"debts[{i}].monthly_payment")
            if known:
                errors.append(known)
    if errors:
        raise InvalidInput(errors)


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
                {
                    "value": c.value,
                    "label": info.label,
                    "default_payment_mode": info.default_mode.value,
                    "suggested_term_months": info.suggested_term_months,
                }
                for c, info in CATEGORIES.items()
            ],
            "payment_modes": [m.value for m in PaymentMode],
            "household_types": [
                {"value": "single", "label": "Just me"},
                {"value": "couple", "label": "Couple"},
            ],
            "frequencies": [{"value": f.value, "label": i.label} for f, i in FREQUENCIES.items()],
            "expense_groups": [
                {"value": g.value, "label": label} for g, label in GROUP_LABELS.items()
            ],
            "expense_categories": [
                {
                    "value": c.value,
                    "label": i.label,
                    "group": i.group.value,
                    "enterable": i.enterable,
                    "from_debts": i.from_debts,
                }
                for c, i in EXPENSE_CATEGORIES.items()
            ],
            "asset_types": [
                {"value": t.value, "label": i.label, "liquid": i.liquid}
                for t, i in ASSET_TYPES.items()
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
            if loan.payment_mode is PaymentMode.FIXED_TERM:
                assert loan.term_months is not None
                result = amortize(
                    loan.principal,
                    loan.annual_rate,
                    loan.term_months,
                    loan.extra_monthly,
                    loan.lump_sums,
                )
            else:
                assert loan.monthly_payment is not None
                result = amortize_payment(
                    loan.principal,
                    loan.annual_rate,
                    loan.monthly_payment,
                    loan.extra_monthly,
                    loan.lump_sums,
                )
        except (LoanInputError, LoanInputTypeError) as exc:
            raise _engine_error(exc) from None
        notes = notes_for_category(loan.category)
        return _with_version(serialize.amortization(result, notes))

    @router.post("/debts")
    async def debts(request: Request) -> dict[str, Any]:
        debt_list = parsing.parse_debts(await _read_json(request))
        _check_payments(debt_list)
        try:
            result = analyze_debts(debt_list)
        except DebtInputError as exc:
            raise _engine_error(exc, [d.id for d in debt_list]) from None
        return _with_version(serialize.debts(result))

    @router.post("/strategies")
    async def strategies(request: Request) -> dict[str, Any]:
        data = parsing.parse_strategy(await _read_json(request))
        _check_payments(data.debts)
        try:
            result = run_strategy(data.debts, data.extra_monthly, data.strategy, data.custom_order)
        except DebtInputError as exc:
            raise _engine_error(exc, [d.id for d in data.debts]) from None
        return _with_version(serialize.strategy(result))

    @router.post("/strategies/compare")
    async def strategies_compare(request: Request) -> dict[str, Any]:
        data = parsing.parse_compare(await _read_json(request))
        _check_payments(data.debts)
        try:
            result = compare_strategies(data.debts, data.extra_monthly)
        except DebtInputError as exc:
            raise _engine_error(exc, [d.id for d in data.debts]) from None
        return _with_version(serialize.comparison(result))

    @router.post("/household")
    async def household(request: Request) -> dict[str, Any]:
        data = household_parsing.parse_household(await _read_json(request))
        _check_payments(list(data.debts))
        try:
            result = analyze_household(data)
        except HouseholdInputError as exc:
            raise InvalidInput([FieldError(exc.field, exc.message)]) from None
        except DebtInputError as exc:
            raise _engine_error(exc, [d.id for d in data.debts]) from None
        return _with_version(serialize.household(result))

    app.include_router(router)
    return app


app = create_app(Settings.from_env(os.environ))
