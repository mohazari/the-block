"""Development-only endpoints. Mounted only when ALLOW_DEV_RESET is set (`npm run dev` does)."""

import asyncio
from typing import Annotated

from fastapi import APIRouter, Query, Request, Response, status

from app.seed import data_epoch, reset

router = APIRouter(prefix="/api/dev", tags=["dev"])


@router.post(
    "/reset",
    status_code=status.HTTP_204_NO_CONTENT,
    responses={409: {"description": "This server uses a different database"}},
)
async def reset_data(
    request: Request,
    database_url: Annotated[
        str | None, Query(description="Reseed only if this is the server's database.")
    ] = None,
) -> Response:
    """Reseed in-process (what `npm run reset-db` calls while the server runs).

    The server owns the reset, so it knows the moment the data changes: it takes the bid write
    lock (in-flight bids finish first), reseeds, records the new epoch and ends every live
    stream. Browsers reconnect and their hello carries the new epoch, so they drop their cache.
    """
    state = request.app.state
    if database_url is not None and database_url != state.database_url:
        return Response(status_code=status.HTTP_409_CONFLICT)
    await asyncio.to_thread(reset, state.engine, state.data_path, state.clock.now())
    state.data_epoch = await asyncio.to_thread(data_epoch, state.engine)
    state.broker.close_all()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
