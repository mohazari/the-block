"""`npm run reset-db` against a running server: the server reseeds its own data."""

import asyncio
import secrets
from typing import Annotated

from fastapi import APIRouter, Header, Request, Response, status

from app.errors import ApiError
from app.seed import reset

router = APIRouter(prefix="/api/dev", tags=["dev"])


@router.post("/reset", status_code=status.HTTP_204_NO_CONTENT, include_in_schema=False)
async def reset_data(
    request: Request, x_reset_token: Annotated[str | None, Header()] = None
) -> Response:
    """Reseed in-process, so the server knows the moment its data changes.

    The token comes from the lock file only this server's user can read (see serverlock.py),
    and a custom header can't be sent cross-origin without a CORS preflight, which this app
    never grants: a web page can't trigger this.
    """
    state = request.app.state
    if x_reset_token is None or not secrets.compare_digest(x_reset_token, state.reset_token):
        raise ApiError(403, "forbidden", "Resetting needs this server's reset token.")
    async with state.reset_lock:  # one at a time, so epochs are recorded in commit order
        # Under the bid write lock (BEGIN IMMEDIATE): in-flight bids finish first.
        epoch = await asyncio.to_thread(
            reset, state.engine, state.settings.data_path, state.clock.now()
        )
        # Straight after the commit, back to back on the event loop: every hello and response
        # from here on carries the new epoch, and every stream that saw the old one ends.
        state.data_epoch = epoch
        state.broker.close_all()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
