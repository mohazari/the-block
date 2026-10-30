"""Lane's reply: a JSON object with the message for the buyer and the cars it recommends.

Structured output keeps picks machine-readable (and checkable against the database), and it also
makes every model write its answer into the final message: without it, some models finish a turn
that used a tool with an empty one. The message still streams: `MessageStream` reads the
"message" string out of the JSON as it arrives.
"""

import json
import re
from dataclasses import dataclass, field
from typing import Any

MAX_PICKS = 4
KINDS = ("recommend", "ask", "nothing_fits")

REPLY_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "message": {"type": "string"},
        # An explicit decision before the picks: without it, a model would sometimes describe
        # cars in the message and leave `picks` empty.
        "kind": {"type": "string", "enum": list(KINDS)},
        "picks": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "vehicle_id": {"type": "string"},
                    "reason": {"type": "string"},
                },
                "required": ["vehicle_id", "reason"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["message", "kind", "picks"],
    "additionalProperties": False,
}

_MESSAGE_KEY = re.compile(r'"message"\s*:\s*"')
_ESCAPES = {'"': '"', "\\": "\\", "/": "/", "b": "\b", "f": "\f", "n": "\n", "r": "\r", "t": "\t"}


class MessageStream:
    """Feeds on the reply's JSON as it streams and returns the new text of its "message"."""

    def __init__(self) -> None:
        self._raw = ""
        self._position: int | None = None  # where the message's next character starts
        self._done = False
        self._pending_high: str | None = None  # first half of a \\u surrogate pair

    def feed(self, delta: str) -> str:
        self._raw += delta
        if self._done:
            return ""
        if self._position is None:
            match = _MESSAGE_KEY.search(self._raw)
            if match is None:
                return ""
            self._position = match.end()
        out: list[str] = []
        raw, i = self._raw, self._position
        while i < len(raw):
            char = raw[i]
            if char == '"':
                self._done = True
                break
            if char != "\\":
                out.append(char)
                i += 1
                continue
            if i + 1 >= len(raw):
                break  # the escape continues in the next delta
            code = raw[i + 1]
            if code != "u":
                out.append(_ESCAPES.get(code, code))
                i += 2
                continue
            if i + 6 > len(raw):
                break
            unit = int(raw[i + 2 : i + 6], 16)
            i += 6
            if 0xD800 <= unit < 0xDC00:
                self._pending_high = chr(unit)
                continue
            if 0xDC00 <= unit < 0xE000 and self._pending_high is not None:
                pair = (self._pending_high + chr(unit)).encode("utf-16", "surrogatepass")
                out.append(pair.decode("utf-16"))
                self._pending_high = None
                continue
            out.append(chr(unit))
        self._position = i
        return "".join(out)


@dataclass
class Reply:
    message: str
    picks: list[tuple[str, str]] = field(default_factory=list)  # (vehicle id, reason)
    kind: str = "ask"  # recommend | ask | nothing_fits


def parse_reply(text: str) -> Reply:
    """The final reply. Anything that isn't the agreed JSON is shown as plain text, no picks."""
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        return Reply(message=text.strip())
    if not isinstance(data, dict):
        return Reply(message=text.strip())
    message = data.get("message")
    picks: list[tuple[str, str]] = []
    seen: set[str] = set()
    for pick in data.get("picks") or []:
        if not isinstance(pick, dict):
            continue
        vehicle_id, reason = pick.get("vehicle_id"), pick.get("reason")
        if isinstance(vehicle_id, str) and isinstance(reason, str) and vehicle_id not in seen:
            seen.add(vehicle_id)
            picks.append((vehicle_id, reason.strip()))
    kind = data.get("kind")
    if kind not in KINDS:
        kind = "recommend" if picks else "nothing_fits"
    return Reply(
        message=message.strip() if isinstance(message, str) else "", picks=picks, kind=kind
    )
