"""Lane, the car-finding assistant: sign-in, model choice and the chat stream."""

from collections.abc import AsyncGenerator
from typing import Annotated

from fastapi import APIRouter, Depends, Path, Request, Response, status
from fastapi.sse import EventSourceResponse, ServerSentEvent

from app.deps import RequiredBidderId
from app.errors import ApiError
from app.lane.agent import Lane
from app.lane.codex import CodexError
from app.lane.schemas import CONVERSATION_ID_PATTERN, LaneMessage, LaneModel, LaneSignIn, LaneStatus

router = APIRouter(prefix="/api/lane", tags=["lane"])

_OFF = "Lane is turned off on this server (LANE_ENABLED=0)."


def _lane_or_none(request: Request) -> Lane | None:
    lane: Lane | None = request.app.state.lane
    return lane


def _lane(lane: Annotated[Lane | None, Depends(_lane_or_none)]) -> Lane:
    if lane is None:
        raise ApiError(503, "lane_unavailable", _OFF)
    return lane


LaneDep = Annotated[Lane, Depends(_lane)]


def _unavailable(exc: CodexError) -> ApiError:
    return ApiError(503, "lane_unavailable", str(exc))


@router.get("/status")
async def lane_status(lane: Annotated[Lane | None, Depends(_lane_or_none)]) -> LaneStatus:
    """Whether Lane can run, whether it's signed in to ChatGPT, and how much usage is left."""
    if lane is None:
        return LaneStatus(
            available=False,
            problem=_OFF,
            signed_in=False,
            plan=None,
            signing_in=False,
            sign_in_error=None,
            usage=None,
        )
    try:
        return await lane.status()
    except CodexError as exc:
        raise _unavailable(exc) from exc


@router.post("/sign-in")
async def sign_in(lane: LaneDep) -> LaneSignIn:
    """Start signing in with ChatGPT: open `auth_url`, then poll the status until it's done."""
    try:
        return LaneSignIn(auth_url=await lane.sign_in())
    except CodexError as exc:
        raise _unavailable(exc) from exc


@router.post("/sign-in/cancel", status_code=status.HTTP_204_NO_CONTENT)
async def cancel_sign_in(lane: LaneDep) -> Response:
    await lane.cancel_sign_in()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/sign-out", status_code=status.HTTP_204_NO_CONTENT)
async def sign_out(lane: LaneDep) -> Response:
    try:
        await lane.sign_out()
    except CodexError as exc:
        raise _unavailable(exc) from exc
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/models")
async def models(lane: LaneDep) -> list[LaneModel]:
    """The models the signed-in ChatGPT plan offers, each with the efforts it supports."""
    try:
        return await lane.models()
    except CodexError as exc:
        raise _unavailable(exc) from exc


async def _checked(message: LaneMessage, lane: LaneDep) -> LaneMessage:
    # A dependency, so it runs before the stream's 200: a bad choice is a plain 422.
    try:
        problem = await lane.check_choice(message.model, message.effort)
    except CodexError as exc:
        raise _unavailable(exc) from exc
    if problem:
        raise ApiError(422, "invalid_choice", problem)
    return message


@router.post("/messages", response_class=EventSourceResponse)
async def send_message(
    message: Annotated[LaneMessage, Depends(_checked)], lane: LaneDep, bidder_id: RequiredBidderId
) -> AsyncGenerator[ServerSentEvent]:
    """Ask Lane something. Streams `step` and `text` events, then one `reply` or `problem`."""
    async for event in lane.reply(message, bidder_id):
        yield ServerSentEvent(event=event.type, data=event.model_dump(mode="json"))


@router.post("/conversations/{conversation_id}/stop", status_code=status.HTTP_204_NO_CONTENT)
async def stop(
    conversation_id: Annotated[str, Path(pattern=CONVERSATION_ID_PATTERN)],
    lane: LaneDep,
    bidder_id: RequiredBidderId,
) -> Response:
    """Stop the answer Lane is writing; the stream then ends with a `lane_stopped` problem."""
    await lane.interrupt(conversation_id, bidder_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
