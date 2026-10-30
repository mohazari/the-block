"""A stand-in for `codex app-server`, so tests (and the e2e run) never call a real model.

It speaks the same JSON lines and plays a scenario from the JSON file in FAKE_CODEX_SCENARIO:

    {"signed_in": true, "version": "0.163.0",
     "turns": [[{"tool": "search_vehicles", "arguments": {"make": ["Ford"]}},
                {"reply": {"message": "…", "picks": [{"vehicle_id": "…", "reason": "…"}]}}]]}

Each turn is a list of steps, played in order: `tool` (call one of Lane's tools), `reply` (stream
the final JSON), `text` (a final message that isn't JSON), `fail` (a turn error, by Codex's error
name), `forbidden` (start a non-Lane tool item; `complete_after` delays its completion), `sleep`
(seconds) or `hang` (wait to be interrupted). `turn_start_delay` (top level) slows turn/start.
The scenario is read when the fake starts, so a restarted fake picks up a rewritten file. Without a
scenario, every turn searches the inventory and replies with the first vehicle found.

Every message it receives is appended to FAKE_CODEX_LOG, when set, for tests to inspect.
"""

import asyncio
import contextlib
import json
import os
import sys
from typing import Any

SCENARIO: dict[str, Any] = {}
if path := os.environ.get("FAKE_CODEX_SCENARIO"):
    with open(path) as file:  # noqa: PTH123 - kept dependency-free and simple
        SCENARIO = json.load(file)

DEFAULT_TURN: list[dict[str, Any]] = [
    {"tool": "search_vehicles", "arguments": {"status": ["live"], "limit": 3}},
    {"reply": "first-found"},
]
MODELS = [
    {
        "id": "fake-large",
        "model": "fake-large",
        "displayName": "Fake Large",
        "description": "The careful one.",
        "hidden": False,
        "isDefault": True,
        "defaultReasoningEffort": "medium",
        "supportedReasoningEfforts": [
            {"reasoningEffort": "low", "description": "Quick"},
            {"reasoningEffort": "medium", "description": "Balanced"},
            {"reasoningEffort": "high", "description": "Thorough"},
        ],
    },
    {
        "id": "fake-small",
        "model": "fake-small",
        "displayName": "Fake Small",
        "description": "The quick one.",
        "hidden": False,
        "isDefault": False,
        "defaultReasoningEffort": "low",
        "supportedReasoningEfforts": [{"reasoningEffort": "low", "description": "Quick"}],
    },
]


class Fake:
    def __init__(self) -> None:
        self.signed_in = bool(SCENARIO.get("signed_in", True))
        self.turn_index = 0
        self.logins = 0
        self.next_id = 1000
        self.waiting: dict[int, asyncio.Future[Any]] = {}
        self.interrupts: dict[str, asyncio.Event] = {}
        self.out = sys.stdout
        self.tasks: set[asyncio.Task[None]] = set()  # keeps running tasks referenced

    def send(self, message: dict[str, Any]) -> None:
        self.out.write(json.dumps(message) + "\n")
        self.out.flush()

    def notify(self, method: str, params: dict[str, Any]) -> None:
        self.send({"method": method, "params": params})

    async def ask(self, method: str, params: dict[str, Any]) -> Any:
        self.next_id += 1
        future: asyncio.Future[Any] = asyncio.get_running_loop().create_future()
        self.waiting[self.next_id] = future
        self.send({"id": self.next_id, "method": method, "params": params})
        return await future

    async def handle(self, message: dict[str, Any]) -> None:
        if log := os.environ.get("FAKE_CODEX_LOG"):
            with open(log, "a") as file:  # noqa: PTH123
                file.write(json.dumps(message) + "\n")
        if "method" not in message:  # a response to one of our requests
            future = self.waiting.pop(message["id"], None)
            if future is not None:
                future.set_result(message.get("result", message.get("error")))
            return
        method, params, request_id = message["method"], message.get("params", {}), message.get("id")
        if request_id is None:
            return  # notifications (initialized)
        result = await self.answer(method, params)
        self.send({"id": request_id, "result": result})

    async def answer(self, method: str, params: dict[str, Any]) -> dict[str, Any]:
        if method == "initialize":
            version = SCENARIO.get("version", "0.163.0")
            return {"userAgent": f"the_block_lane/{version} (fake)", "codexHome": "/tmp"}
        if method == "account/read":
            account = {"type": "chatgpt", "email": None, "planType": "plus"}
            return {"account": account if self.signed_in else None, "requiresOpenaiAuth": True}
        if method == "account/rateLimits/read":
            window = {"usedPercent": 12, "windowDurationMins": 300, "resetsAt": 1793330000}
            return {"rateLimits": {"primary": window}}
        if method == "account/login/start":
            self.logins += 1
            login_id = f"login-{self.logins}"
            outcome = SCENARIO.get("sign_in", "succeed")  # succeed | fail | never
            if outcome != "never":
                success = outcome == "succeed"
                asyncio.get_running_loop().call_later(0.05, self.finish_login, login_id, success)
            return {"type": "chatgpt", "loginId": login_id, "authUrl": "https://auth.example/x"}
        if method in ("account/login/cancel", "account/logout"):
            if method == "account/logout":
                self.signed_in = False
            return {}
        if method == "model/list":
            return {"data": MODELS, "nextCursor": None}
        if method == "thread/start":
            return {"thread": {"id": f"thread-{self.turn_index}"}, "model": "fake-large"}
        if method == "turn/start":
            await asyncio.sleep(SCENARIO.get("turn_start_delay", 0))  # a slow model start
            turn_id = f"turn-{self.turn_index}"
            turns: list[list[dict[str, Any]]] = SCENARIO.get("turns", [])
            steps = turns[self.turn_index] if self.turn_index < len(turns) else DEFAULT_TURN
            self.turn_index += 1
            self.interrupts[turn_id] = asyncio.Event()
            self.tasks.add(asyncio.create_task(self.play(params["threadId"], turn_id, steps)))
            return {"turn": {"id": turn_id, "items": [], "status": "inProgress"}}
        if method == "thread/unsubscribe":
            return {"status": "unsubscribed"}
        if method == "turn/interrupt":
            self.interrupts.get(params["turnId"], asyncio.Event()).set()
            return {}
        raise SystemExit(f"fake codex: unexpected {method}")

    def finish_login(self, login_id: str, success: bool) -> None:
        self.signed_in = success
        self.notify("account/login/completed", {"loginId": login_id, "success": success})

    async def play(self, thread_id: str, turn_id: str, steps: list[dict[str, Any]]) -> None:
        ids = {"threadId": thread_id, "turnId": turn_id}
        found: list[str] = []

        def complete(status: str, error: dict[str, Any] | None = None) -> None:
            turn: dict[str, Any] = {"id": turn_id, "items": [], "status": status, "error": error}
            self.notify("turn/completed", {"threadId": thread_id, "turn": turn})

        for number, step in enumerate(steps):
            if "tool" in step:
                item = {"type": "dynamicToolCall", "id": f"call-{number}", "tool": step["tool"]}
                self.notify("item/started", {**ids, "item": {**item, "status": "inProgress"}})
                result = await self.ask(
                    "item/tool/call",
                    {
                        **ids,
                        "callId": item["id"],
                        "tool": step["tool"],
                        "arguments": step.get("arguments", {}),
                    },
                )
                text = (result or {}).get("contentItems", [{}])[0].get("text", "")
                with contextlib.suppress(json.JSONDecodeError, AttributeError):
                    found += [v["id"] for v in json.loads(text).get("vehicles", [])]
                self.notify("item/completed", {**ids, "item": {**item, "status": "completed"}})
            elif "reply" in step or "text" in step:
                if "text" in step:
                    text = step["text"]
                elif step["reply"] == "first-found":
                    picks = [{"vehicle_id": found[0], "reason": "First match."}] if found else []
                    kind = "recommend" if picks else "nothing_fits"
                    reply = {"message": "Here's one to look at.", "kind": kind, "picks": picks}
                    text = json.dumps(reply)
                else:
                    text = json.dumps(step["reply"])
                item = {"type": "agentMessage", "id": "msg-1", "text": ""}
                self.notify("item/started", {**ids, "item": item})
                for start in range(0, len(text), 7):
                    self.notify(
                        "item/agentMessage/delta",
                        {**ids, "itemId": "msg-1", "delta": text[start : start + 7]},
                    )
                    await asyncio.sleep(0)
                self.notify("item/completed", {**ids, "item": {**item, "text": text}})
            elif "fail" in step:
                error = {"message": "upstream said no", "codexErrorInfo": step["fail"]}
                self.notify("error", {**ids, "error": error, "willRetry": False})
                complete("failed", error)
                return
            elif "forbidden" in step:
                item = {"type": step["forbidden"], "id": "bad-1", "status": "inProgress"}
                self.notify("item/started", {**ids, "item": item})
                await self.interrupts[turn_id].wait()
                await asyncio.sleep(step.get("complete_after", 0))  # a late completion
                complete("interrupted")
                return
            elif "sleep" in step:
                await asyncio.sleep(step["sleep"])
            elif "hang" in step:
                await self.interrupts[turn_id].wait()
                complete("interrupted")
                return
        complete("completed")


async def main() -> None:
    if "--version" in sys.argv:
        print(f"codex-cli {SCENARIO.get('version', '0.163.0')}")
        return
    if SCENARIO.get("exit_on_start"):  # e.g. a config Codex rejects
        sys.stderr.write("Error: Unknown feature flag: goals\n")
        sys.exit(1)
    if log := os.environ.get("FAKE_CODEX_LOG"):
        with open(log, "a") as file:  # noqa: PTH123
            file.write(
                json.dumps({"argv": sys.argv[1:], "codex_home": os.environ.get("CODEX_HOME")})
                + "\n"
            )
    fake = Fake()
    loop = asyncio.get_running_loop()
    reader = asyncio.StreamReader(limit=16 * 1024 * 1024)
    await loop.connect_read_pipe(lambda: asyncio.StreamReaderProtocol(reader), sys.stdin)
    while line := await reader.readline():
        fake.tasks.add(loop.create_task(fake.handle(json.loads(line))))


if __name__ == "__main__":
    asyncio.run(main())
