"""Request-scoped dependencies: clock, database sessions and the anonymous bidder id."""

import re
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.clock import Clock
from app.db import session_scope
from app.domain.bidders import RIVAL_BIDDER_IDS
from app.errors import ApiError

_BIDDER_ID = re.compile(r"^[A-Za-z0-9-]{8,64}$")


def get_clock(request: Request) -> Clock:
    clock: Clock = request.app.state.clock
    return clock


def get_now(clock: Annotated[Clock, Depends(get_clock)]) -> datetime:
    """One timestamp per request, so every derived status in a response agrees."""
    return clock.now()


def get_session(request: Request) -> Iterator[Session]:
    with request.app.state.sessions() as session:
        yield session


def get_write_session(request: Request) -> Iterator[Session]:
    """Session whose transaction starts with BEGIN IMMEDIATE (see app/db.py).

    Commits when the endpoint returns, rolls back if it raises. Used with scope="function" (see
    WriteSession): FastAPI's default runs this teardown only *after* the response has been sent,
    which would acknowledge a write before it is committed and hold the write lock meanwhile.
    """
    with session_scope(request.app.state.write_sessions) as session:
        yield session


def validate_bidder_id(value: str | None, field: str) -> str | None:
    if value is None:
        return None
    if not _BIDDER_ID.match(value) or value in RIVAL_BIDDER_IDS:
        raise ApiError(400, "invalid_bidder_id", f"{field}: 8-64 letters, digits or dashes.")
    return value


def get_bidder_id(
    x_bidder_id: Annotated[str | None, Header(description="Anonymous browser id.")] = None,
) -> str | None:
    return validate_bidder_id(x_bidder_id, field="X-Bidder-Id")


def require_bidder_id(bidder_id: Annotated[str | None, Depends(get_bidder_id)]) -> str:
    if bidder_id is None:
        raise ApiError(400, "bidder_id_required", "Send an X-Bidder-Id header to bid or watch.")
    return bidder_id


Now = Annotated[datetime, Depends(get_now)]
# scope="function": close (and commit) before the response is sent, not after.
DbSession = Annotated[Session, Depends(get_session, scope="function")]
WriteSession = Annotated[Session, Depends(get_write_session, scope="function")]
BidderId = Annotated[str | None, Depends(get_bidder_id)]
RequiredBidderId = Annotated[str, Depends(require_bidder_id)]
