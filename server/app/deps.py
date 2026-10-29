"""Request-scoped dependencies: clock, database sessions and the anonymous bidder id."""

import re
from collections.abc import Iterator
from datetime import datetime
from typing import Annotated

from fastapi import Depends, Header, Request
from sqlalchemy.orm import Session

from app.clock import Clock
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
    """Session whose transaction starts with BEGIN IMMEDIATE (see app/db.py)."""
    with request.app.state.write_sessions() as session:
        yield session


def get_bidder_id(
    x_bidder_id: Annotated[str | None, Header(description="Anonymous browser id.")] = None,
) -> str | None:
    if x_bidder_id is None:
        return None
    if not _BIDDER_ID.match(x_bidder_id) or x_bidder_id in RIVAL_BIDDER_IDS:
        raise ApiError(400, "invalid_bidder_id", "X-Bidder-Id: 8-64 letters, digits or dashes.")
    return x_bidder_id


def require_bidder_id(bidder_id: Annotated[str | None, Depends(get_bidder_id)]) -> str:
    if bidder_id is None:
        raise ApiError(400, "bidder_id_required", "Send an X-Bidder-Id header to bid or watch.")
    return bidder_id


Now = Annotated[datetime, Depends(get_now)]
DbSession = Annotated[Session, Depends(get_session)]
WriteSession = Annotated[Session, Depends(get_write_session)]
BidderId = Annotated[str | None, Depends(get_bidder_id)]
RequiredBidderId = Annotated[str, Depends(require_bidder_id)]
