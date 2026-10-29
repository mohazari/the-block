"""One error shape for every failure: `{"error": {"code", "message", ...details}}`.

Clients branch on the stable `code`, show `message`, and can use details such as a fresh auction
snapshot to recover (e.g. "you were outbid while confirming — new minimum is $23,800").
"""

import logging
from http import HTTPStatus
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from sqlalchemy.exc import OperationalError
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.epoch import HEADER as EPOCH_HEADER
from app.epoch import epoch_for

logger = logging.getLogger(__name__)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def _response(status: int, code: str, message: str, **details: Any) -> JSONResponse:
    return JSONResponse(
        status_code=status, content={"error": {"code": code, "message": message, **details}}
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return _response(exc.status, exc.code, exc.message, **exc.details)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        issues = [
            {"field": ".".join(str(part) for part in err["loc"][1:]), "message": err["msg"]}
            for err in exc.errors()
        ]
        return _response(422, "invalid_request", "Some fields are invalid.", issues=issues)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        # Framework-level errors: unknown route (404), wrong method (405), …
        code = HTTPStatus(exc.status_code).phrase.lower().replace(" ", "_")
        return _response(exc.status_code, code, str(exc.detail))

    @app.exception_handler(OperationalError)
    async def _db_busy(request: Request, exc: OperationalError) -> JSONResponse:
        if "database is locked" not in str(exc.orig):
            return await _unexpected(request, exc)
        # Waited the full busy timeout for the write lock: safe to retry, nothing was written.
        response = _response(503, "busy", "Lots of bidding right now — please try again.")
        response.headers["Retry-After"] = "1"
        return response

    @app.exception_handler(Exception)
    async def _unexpected(request: Request, exc: Exception) -> JSONResponse:
        logger.exception("Unhandled error on %s %s", request.method, request.url.path)
        response = _response(500, "internal_error", "Something went wrong on our side.")
        # Starlette answers unhandled errors outside every middleware, DataEpochHeader included.
        epoch = epoch_for(request.app, request.url.path)
        if epoch is not None:
            response.headers[EPOCH_HEADER] = epoch
        return response
