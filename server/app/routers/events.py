"""Live auction updates over Server-Sent Events.

SSE rather than WebSockets: updates only flow server → client (bids are ordinary POSTs), it is
plain HTTP through the Vite proxy, and the browser's EventSource reconnects on its own.
"""

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request
from fastapi.sse import EventSourceResponse, ServerSentEvent

from app.deps import validate_bidder_id
from app.events import EventBroker
from app.seed import data_epoch

router = APIRouter(prefix="/api", tags=["events"])

# Tell the browser to retry quickly if the connection drops.
_RETRY_MS = 2_000


def _stream_bidder_id(
    bidder_id: Annotated[
        str | None,
        Query(description="EventSource cannot send headers, so the bidder id rides the URL."),
    ] = None,
) -> str | None:
    # A dependency, not a check inside the stream: dependencies run before the 200 and the
    # event-stream headers are sent, so an invalid id can still get a proper 400.
    return validate_bidder_id(bidder_id, field="bidder_id")


@router.get("/events", response_class=EventSourceResponse)
async def events(
    request: Request,
    bidder_id: Annotated[str | None, Depends(_stream_bidder_id)],
) -> AsyncGenerator[ServerSentEvent]:
    """Stream `bid` and `sold` events, personalized for `bidder_id` (outbid_you, is_you)."""
    broker: EventBroker = request.app.state.broker
    async with broker.subscribe(bidder_id) as subscriber:
        clock = request.app.state.clock
        # `epoch` changes when the data is reseeded: clients must then drop what they cached,
        # since bid counts restart and can no longer order old against new.
        epoch = data_epoch(request.app.state.engine)
        hello = {"server_time": clock.now().isoformat(), "epoch": epoch}
        yield ServerSentEvent(event="hello", data=hello, retry=_RETRY_MS)
        while True:
            event = await subscriber.queue.get()
            if event is None:  # dropped as a slow consumer: end the stream so it reconnects
                return
            # No event ids: events aren't replayable, so we don't pretend they are. Instead the
            # `hello` sent on every (re)connect tells the client to refetch what it shows.
            yield ServerSentEvent(event=event.kind, data=event.for_subscriber(bidder_id))
