"""One error shape for every failure: `{"error": {"code", "message", ...details}}`.

Clients branch on the stable `code`, show `message`, and can use details such as a fresh auction
snapshot to recover (e.g. "you were outbid while confirming — new minimum is $23,800").
"""

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, **details: Any) -> None:
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.details = details


def _body(code: str, message: str, **details: Any) -> dict[str, Any]:
    return {"error": {"code": code, "message": message, **details}}


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(
            status_code=exc.status, content=_body(exc.code, exc.message, **exc.details)
        )

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        issues = [
            {"field": ".".join(str(part) for part in err["loc"][1:]), "message": err["msg"]}
            for err in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content=_body("invalid_request", "Some fields are invalid.", issues=issues),
        )
