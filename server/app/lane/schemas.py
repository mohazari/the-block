"""Lane's request, response and stream models (also exported to the web client's types)."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field

from app.schemas import VehicleSummary


class LaneUsage(BaseModel):
    used_percent: int = Field(description="Share of the plan's current usage window used.")
    window_minutes: int | None
    resets_at: datetime | None


class LaneStatus(BaseModel):
    available: bool = Field(description="Codex is installed and running.")
    problem: str | None = Field(description="Why Lane isn't available, for the buyer.")
    signed_in: bool
    plan: str | None = Field(description='ChatGPT plan, e.g. "plus".')
    signing_in: bool = Field(description="A browser sign-in is waiting to finish.")
    sign_in_error: str | None
    usage: LaneUsage | None


class LaneSignIn(BaseModel):
    auth_url: str = Field(description="Open in a browser tab to sign in with ChatGPT.")


class LaneEffort(BaseModel):
    value: str
    description: str


class LaneModel(BaseModel):
    id: str
    name: str
    description: str
    is_default: bool
    default_effort: str
    efforts: list[LaneEffort]


CONVERSATION_ID_PATTERN = r"^[A-Za-z0-9-]{8,64}$"


class LaneMessage(BaseModel):
    conversation_id: str = Field(pattern=CONVERSATION_ID_PATTERN)
    text: str = Field(min_length=1, max_length=2000)
    model: str | None = Field(default=None, max_length=100)
    effort: str | None = Field(default=None, max_length=40)
    vehicle_id: str | None = Field(
        default=None, max_length=64, description="The car the buyer is looking at, if any."
    )
    time_zone: str | None = Field(
        default=None, max_length=64, description='The buyer\'s IANA zone, e.g. "America/Toronto".'
    )


# Stream events, in order: any number of `step` and `text`, then one `reply` or `problem`.


class LaneStep(BaseModel):
    type: Literal["step"] = "step"
    label: str = Field(description='What Lane is doing, e.g. "Searching the run list".')


class LaneText(BaseModel):
    type: Literal["text"] = "text"
    delta: str


class LanePick(BaseModel):
    vehicle: VehicleSummary
    reason: str


class LaneReply(BaseModel):
    type: Literal["reply"] = "reply"
    message: str = Field(description="The whole message: replaces the streamed text.")
    picks: list[LanePick]
    search: dict[str, str | int | float | bool | list[str]] | None = Field(
        description="The run-list filters behind the picks, to open them as a list."
    )


class LaneProblem(BaseModel):
    type: Literal["problem"] = "problem"
    code: str
    message: str
