"""Lane, the car-finding assistant, against a fake `codex app-server` (tests/fake_codex.py)."""

import json
import sys
import threading
import time
from collections.abc import Callable, Iterator
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.clock import FrozenClock
from app.config import Settings
from app.lane.agent import parse_version, problem_for
from app.lane.codex import DISABLED_FEATURES
from app.lane.reply import MessageStream, parse_reply
from app.lane.tools import ToolError, search_query
from app.main import create_app
from tests.conftest import DATA_PATH

FAKE = Path(__file__).with_name("fake_codex.py")
ME = {"X-Bidder-Id": "browser-me-0001"}
CONVERSATION = "chat-0001"

LaneClient = Callable[..., TestClient]


class Log:
    def __init__(self, path: Path) -> None:
        self.path = path

    def messages(self) -> list[dict[str, Any]]:
        if not self.path.exists():
            return []
        return [json.loads(line) for line in self.path.read_text().splitlines()]

    def requests(self, method: str) -> list[dict[str, Any]]:
        return [m["params"] for m in self.messages() if m.get("method") == method and "id" in m]

    def tool_results(self) -> list[dict[str, Any]]:
        """Our answers to the fake's tool calls (responses carry no method)."""
        return [m["result"] for m in self.messages() if "result" in m and "method" not in m]


@pytest.fixture
def log(tmp_path: Path) -> Log:
    return Log(tmp_path / "codex.log")


@pytest.fixture
def lane_client(
    tmp_path: Path, clock: FrozenClock, log: Log, monkeypatch: pytest.MonkeyPatch
) -> Iterator[LaneClient]:
    """Starts the app with a fake Codex playing `scenario`. Calling it again stops the previous
    app first (one server per database) and keeps the data, bids included."""
    clients: list[TestClient] = []

    def make(scenario: dict[str, Any] | None = None, **settings: Any) -> TestClient:
        while clients:
            clients.pop().__exit__(None, None, None)
        if scenario is not None:
            path = tmp_path / "scenario.json"
            path.write_text(json.dumps(scenario))
            monkeypatch.setenv("FAKE_CODEX_SCENARIO", str(path))
        monkeypatch.setenv("FAKE_CODEX_LOG", str(log.path))
        config = {
            "database_url": f"sqlite:///{tmp_path / 'api.db'}",
            "data_path": DATA_PATH,
            "simulator_enabled": False,
            "lane_command": (sys.executable, str(FAKE)),
            "lane_home": tmp_path / "lane",
            **settings,
        }
        client = TestClient(create_app(Settings(**config), clock))
        client.__enter__()
        clients.append(client)
        return client

    yield make
    for client in clients:
        client.__exit__(None, None, None)


def ask(
    client: TestClient, text: str = "Find me something", **fields: Any
) -> list[tuple[str, Any]]:
    """Send a message and collect the stream's (event, data) pairs."""
    body = {"conversation_id": CONVERSATION, "text": text, **fields}
    events: list[tuple[str, Any]] = []
    with client.stream("POST", "/api/lane/messages", json=body, headers=ME) as response:
        assert response.status_code == 200, response.read()
        event = ""
        for line in response.iter_lines():
            if line.startswith("event:"):
                event = line.removeprefix("event:").strip()
            elif line.startswith("data:"):
                events.append((event, json.loads(line.removeprefix("data:"))))
    return events


def final(events: list[tuple[str, Any]]) -> tuple[str, Any]:
    return events[-1]


def live_vehicles(client: TestClient, **params: Any) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = client.get(
        "/api/vehicles", params={"status": "live", "page_size": 100, **params}
    ).json()["items"]
    return items


# Status, sign-in and models -------------------------------------------------------------------


def test_status_reports_the_plan_and_usage(lane_client: LaneClient) -> None:
    status = lane_client().get("/api/lane/status").json()
    assert status["available"] is True
    assert status["signed_in"] is True
    assert status["plan"] == "plus"
    assert status["usage"]["used_percent"] == 12
    assert status["usage"]["window_minutes"] == 300


def test_codex_runs_locked_down_in_lanes_own_home(
    lane_client: LaneClient, log: Log, tmp_path: Path
) -> None:
    lane_client().get("/api/lane/status")
    [start] = [m for m in log.messages() if "argv" in m]
    assert start["codex_home"] == str(tmp_path / "lane")
    argv = start["argv"]
    assert argv[0] == "app-server"
    disabled = {argv[i + 1] for i, arg in enumerate(argv) if arg == "--disable"}
    assert {"shell_tool", "unified_exec", "apps", "plugins"} <= disabled
    assert disabled == set(DISABLED_FEATURES)
    assert 'web_search="disabled"' in argv


def test_missing_codex_makes_lane_unavailable_not_the_api(lane_client: LaneClient) -> None:
    client = lane_client(lane_command=("/nonexistent/codex",))
    status = client.get("/api/lane/status").json()
    assert status["available"] is False
    assert "Codex CLI" in status["problem"]
    assert client.get("/api/vehicles").status_code == 200


def test_an_old_codex_is_refused(lane_client: LaneClient) -> None:
    status = lane_client({"version": "0.150.2"}).get("/api/lane/status").json()
    assert status["available"] is False
    assert "0.163.0 or newer" in status["problem"]


def test_lane_can_be_turned_off(lane_client: LaneClient) -> None:
    client = lane_client(lane_enabled=False)
    status = client.get("/api/lane/status").json()
    assert status["available"] is False
    assert "LANE_ENABLED" in status["problem"]
    response = client.post(
        "/api/lane/messages", json={"conversation_id": CONVERSATION, "text": "hi"}, headers=ME
    )
    assert response.status_code == 503


def test_signing_in_and_out(lane_client: LaneClient) -> None:
    client = lane_client({"signed_in": False})
    assert client.get("/api/lane/status").json()["signed_in"] is False

    started = client.post("/api/lane/sign-in")
    assert started.json() == {"auth_url": "https://auth.example/x"}
    for _ in range(50):  # the fake completes the browser sign-in shortly after
        status = client.get("/api/lane/status").json()
        if status["signed_in"]:
            break
        time.sleep(0.02)
    assert status["signed_in"] is True
    assert status["signing_in"] is False

    assert client.post("/api/lane/sign-out").status_code == 204
    assert client.get("/api/lane/status").json()["signed_in"] is False


def test_models_list_each_models_efforts(lane_client: LaneClient) -> None:
    models = lane_client().get("/api/lane/models").json()
    assert [m["id"] for m in models] == ["fake-large", "fake-small"]
    large = models[0]
    assert large["is_default"] is True
    assert large["default_effort"] == "medium"
    assert [e["value"] for e in large["efforts"]] == ["low", "medium", "high"]


@pytest.mark.parametrize(
    ("choice", "message"),
    [
        ({"model": "gpt-nope"}, "gpt-nope isn't one of the models"),
        ({"model": "fake-small", "effort": "high"}, "Fake Small doesn't offer high effort"),
        ({"effort": "extreme"}, "Fake Large doesn't offer extreme effort"),
    ],
)
def test_a_model_or_effort_the_plan_lacks_is_refused(
    lane_client: LaneClient, choice: dict[str, str], message: str
) -> None:
    response = lane_client().post(
        "/api/lane/messages",
        json={"conversation_id": CONVERSATION, "text": "hi", **choice},
        headers=ME,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_choice"
    assert message in response.json()["error"]["message"]


# Conversations --------------------------------------------------------------------------------


def test_a_reply_streams_steps_and_text_then_checked_picks(lane_client: LaneClient) -> None:
    client = lane_client()
    suvs = live_vehicles(client, body_style="SUV")
    picks = [{"vehicle_id": v["id"], "reason": f"Reason {i}"} for i, v in enumerate(suvs[:2])]
    scenario = {
        "turns": [
            [
                {"tool": "search_vehicles", "arguments": {"body_style": ["SUV"], "limit": 5}},
                {"reply": {"message": 'Two "SUVs" worth a look.\nBoth live.', "picks": picks}},
            ]
        ]
    }
    client = lane_client(scenario)
    events = ask(client, "An SUV please")

    assert events[0] == ("step", {"type": "step", "label": "Searching the run list"})
    streamed = "".join(data["delta"] for event, data in events if event == "text")
    assert streamed == 'Two "SUVs" worth a look.\nBoth live.'
    event, reply = final(events)
    assert event == "reply"
    assert reply["message"] == streamed
    assert [(p["vehicle"]["id"], p["reason"]) for p in reply["picks"]] == [
        (suvs[0]["id"], "Reason 0"),
        (suvs[1]["id"], "Reason 1"),
    ]
    assert reply["picks"][0]["vehicle"]["auction"]["status"] == "live"
    assert reply["search"] == {"body_style": ["SUV"]}


def test_only_real_vehicles_are_recommended_at_most_four(lane_client: LaneClient) -> None:
    client = lane_client()
    ids = [v["id"] for v in live_vehicles(client)[:6]]
    picks = [{"vehicle_id": "made-up", "reason": "Invented"}]
    picks += [{"vehicle_id": i, "reason": "Real"} for i in [ids[0], ids[0], *ids[1:]]]
    client = lane_client({"turns": [[{"reply": {"message": "Here.", "picks": picks}}]]})
    _, reply = final(ask(client))
    assert [p["vehicle"]["id"] for p in reply["picks"]] == ids[:3]
    assert reply["search"] is None  # no search behind these picks


def test_picks_by_lot_number_count_and_unknown_ones_are_logged(
    lane_client: LaneClient, caplog: pytest.LogCaptureFixture
) -> None:
    client = lane_client()
    vehicle = live_vehicles(client)[0]
    picks = [
        {"vehicle_id": vehicle["lot"], "reason": "By lot"},
        {"vehicle_id": "2024 Ford Bronco", "reason": "By name"},
    ]
    client = lane_client({"turns": [[{"reply": {"message": "Here.", "picks": picks}}]]})
    _, reply = final(ask(client))
    assert [p["vehicle"]["id"] for p in reply["picks"]] == [vehicle["id"]]
    assert "Lane picked vehicles that don't exist: ['2024 Ford Bronco']" in caplog.text


def test_close_times_are_given_on_the_buyers_clock(lane_client: LaneClient, log: Log) -> None:
    scenario = {
        "turns": [
            [{"tool": "search_vehicles", "arguments": {"status": ["live"]}}, {"text": "a"}],
            [{"tool": "search_vehicles", "arguments": {"status": ["live"]}}, {"text": "b"}],
        ]
    }
    client = lane_client(scenario)
    ask(client, time_zone="America/Vancouver")
    ask(client)  # no zone: minutes only
    with_zone, without = (json.loads(r["contentItems"][0]["text"]) for r in log.tool_results())
    first = with_zone["vehicles"][0]
    # The frozen clock is 12:00 UTC on Wed 28 Oct 2026: 05:00 in Vancouver.
    assert first["ends_at_local"].startswith("Wed 2026-10-28 ")
    assert "ends_at_local" not in without["vehicles"][0]
    [first_turn, _] = log.requests("turn/start")
    assert "Wed 2026-10-28 05:00 (America/Vancouver)" in first_turn["input"][0]["text"]


def test_a_recommendation_without_picks_is_asked_for_them_once(
    lane_client: LaneClient, log: Log
) -> None:
    client = lane_client()
    vehicle = live_vehicles(client)[0]
    message = {"message": "These two fit.", "kind": "recommend", "picks": []}
    fixed = {**message, "picks": [{"vehicle_id": vehicle["id"], "reason": "Fits."}]}
    scenario = {
        "turns": [
            [{"tool": "search_vehicles", "arguments": {"status": ["live"]}}, {"reply": message}],
            [{"reply": fixed}],
        ]
    }
    client = lane_client(scenario)
    events = ask(client, model="fake-small", effort="low")
    assert ("step", {"type": "step", "label": "Matching the picks to cars"}) in events
    _, reply = final(events)
    assert reply["message"] == "These two fit."  # the streamed message stands
    assert [p["vehicle"]["id"] for p in reply["picks"]] == [vehicle["id"]]
    assert reply["search"] == {"status": ["live"]}
    _, repair = log.requests("turn/start")
    assert repair["input"][0]["text"].startswith('Your last reply has kind "recommend"')
    assert (repair["model"], repair["effort"]) == ("fake-small", "low")


@pytest.mark.parametrize("kind", ["ask", "nothing_fits"])
def test_a_question_or_no_match_needs_no_picks(
    lane_client: LaneClient, log: Log, kind: str
) -> None:
    client = lane_client({"turns": [[{"reply": {"message": "?", "kind": kind, "picks": []}}]]})
    assert final(ask(client))[1]["picks"] == []
    assert len(log.requests("turn/start")) == 1


def test_a_reply_that_isnt_json_is_shown_as_text(lane_client: LaneClient) -> None:
    client = lane_client({"turns": [[{"text": "Sorry, plain words."}]]})
    assert final(ask(client)) == (
        "reply",
        {"type": "reply", "message": "Sorry, plain words.", "picks": [], "search": None},
    )


def test_each_thread_is_ephemeral_read_only_with_only_lanes_tools(
    lane_client: LaneClient, log: Log
) -> None:
    client = lane_client()
    ask(client, "hello", model="fake-small", effort="low", time_zone="America/Toronto")
    [thread] = log.requests("thread/start")
    assert thread["ephemeral"] is True
    assert thread["sandbox"] == "read-only"
    assert thread["approvalPolicy"] == "never"
    assert {tool["name"] for tool in thread["dynamicTools"]} == {
        "search_vehicles",
        "get_vehicle",
        "my_activity",
    }
    assert "You are Lane" in thread["baseInstructions"]
    assert "- make: " in thread["baseInstructions"]  # the inventory's real filter values

    [turn] = log.requests("turn/start")
    assert turn["model"] == "fake-small"
    assert turn["effort"] == "low"
    assert set(turn["outputSchema"]["required"]) == {"message", "kind", "picks"}
    context = turn["input"][0]["text"]
    assert "(America/Toronto)" in context
    assert turn["input"][1]["text"] == "hello"


def test_follow_ups_reuse_the_thread(lane_client: LaneClient, log: Log) -> None:
    client = lane_client()
    ask(client, "first")
    ask(client, "second", vehicle_id="veh-x")
    assert len(log.requests("thread/start")) == 1
    turns = log.requests("turn/start")
    assert [t["threadId"] for t in turns] == ["thread-0", "thread-0"]
    assert "looking at vehicle veh-x" in turns[1]["input"][0]["text"]


def test_a_conversation_survives_codex_restarting(lane_client: LaneClient, log: Log) -> None:
    client = lane_client()
    assert final(ask(client, "first"))[0] == "reply"
    process = client.app.state.lane._client._process  # type: ignore[attr-defined]
    process.kill()
    for _ in range(100):  # the bridge notices the process is gone
        if not client.app.state.lane._client.running:  # type: ignore[attr-defined]
            break
        time.sleep(0.02)
    assert final(ask(client, "after the crash"))[0] == "reply"
    assert len(log.requests("thread/start")) == 2  # a new thread in the new process


def test_tools_run_as_the_buyer(lane_client: LaneClient, log: Log) -> None:
    client = lane_client()
    vehicle = next(v for v in live_vehicles(client) if not v["auction"]["buy_now_available"])
    amount = vehicle["auction"]["min_next_bid"]
    bid = client.post(f"/api/vehicles/{vehicle['id']}/bids", json={"amount": amount}, headers=ME)
    assert bid.status_code == 201
    client = lane_client({"turns": [[{"tool": "my_activity"}, {"text": "done"}]]})
    ask(client)
    [result] = log.tool_results()
    activity = json.loads(result["contentItems"][0]["text"])
    [mine] = activity["bids"]
    assert mine["id"] == vehicle["id"]
    assert mine["standing"] == "leading"
    assert mine["your_top_bid"] == amount


def test_a_bad_tool_call_goes_back_to_the_model(lane_client: LaneClient, log: Log) -> None:
    scenario = {
        "turns": [
            [
                {"tool": "get_vehicle", "arguments": {"vehicle_id": "nope"}},
                {"tool": "search_vehicles", "arguments": {"year_min": 2030, "year_max": 2020}},
                {"text": "ok"},
            ]
        ]
    }
    ask(lane_client(scenario))
    unknown, invalid = log.tool_results()
    assert unknown["success"] is False
    assert "No vehicle with that id" in unknown["contentItems"][0]["text"]
    assert invalid["success"] is False
    assert "year_min must not exceed year_max" in invalid["contentItems"][0]["text"]


@pytest.mark.parametrize(
    ("error", "code"),
    [
        ("usageLimitExceeded", "lane_usage_limit"),
        ("unauthorized", "lane_signed_out"),
        ("serverOverloaded", "lane_busy"),
        ("sandboxError", "lane_failed"),
    ],
)
def test_turn_errors_become_plain_problems(lane_client: LaneClient, error: str, code: str) -> None:
    client = lane_client({"turns": [[{"fail": error}]]})
    event, problem = final(ask(client))
    assert event == "problem"
    assert problem["code"] == code


def test_any_tool_but_lanes_own_stops_the_turn(lane_client: LaneClient, log: Log) -> None:
    client = lane_client({"turns": [[{"forbidden": "commandExecution"}]]})
    event, problem = final(ask(client))
    assert event == "problem"
    assert problem["message"] == "Lane tried something it isn't allowed to."
    assert log.requests("turn/interrupt") == [{"threadId": "thread-0", "turnId": "turn-0"}]


def test_stop_ends_the_answer(lane_client: LaneClient) -> None:
    client = lane_client({"turns": [[{"hang": True}]]})
    events: list[tuple[str, Any]] = []
    reader = threading.Thread(target=lambda: events.extend(ask(client)))
    reader.start()
    for _ in range(100):
        stopped = client.post(f"/api/lane/conversations/{CONVERSATION}/stop", headers=ME)
        assert stopped.status_code == 204
        reader.join(0.05)
        if not reader.is_alive():
            break
    assert final(events) == (
        "problem",
        {"type": "problem", "code": "lane_stopped", "message": "Stopped."},
    )


def test_a_late_completion_of_a_stopped_turn_doesnt_end_the_next(
    lane_client: LaneClient, log: Log
) -> None:
    # The first turn is stopped by Lane itself, which doesn't wait for its completion; the
    # second must still get its own reply.
    scenario = {"turns": [[{"forbidden": "webSearch"}], [{"text": "second answer"}]]}
    client = lane_client(scenario)
    assert final(ask(client))[0] == "problem"
    assert final(ask(client))[1]["message"] == "second answer"


def test_a_conversation_belongs_to_one_buyer(lane_client: LaneClient) -> None:
    client = lane_client()
    ask(client)
    body = {"conversation_id": CONVERSATION, "text": "mine now"}
    other = {"X-Bidder-Id": "browser-other-0002"}
    with client.stream("POST", "/api/lane/messages", json=body, headers=other) as response:
        lines = [line for line in response.iter_lines() if line.startswith("data:")]
    assert json.loads(lines[-1].removeprefix("data:"))["code"] == "lane_failed"


# Units ----------------------------------------------------------------------------------------


def test_message_stream_reads_the_message_out_of_partial_json() -> None:
    text = json.dumps({"picks": [], "message": 'Say "hi" \\ to 🚗 and café\nnow'})
    stream = MessageStream()
    out = "".join(stream.feed(text[i : i + 3]) for i in range(0, len(text), 3))
    assert out == 'Say "hi" \\ to 🚗 and café\nnow'
    ascii_only = json.dumps({"message": "🚗é"}, ensure_ascii=True)  # \\ud83d\\ude97 escapes
    stream = MessageStream()
    assert "".join(stream.feed(char) for char in ascii_only) == "🚗é"


def test_parse_reply_tolerates_odd_shapes() -> None:
    assert parse_reply(
        '{"message": " Hi ", "picks": [{"vehicle_id": "a", "reason": "r"}]}'
    ).picks == [("a", "r")]
    assert parse_reply("[1, 2]").message == "[1, 2]"
    odd = parse_reply('{"message": 5, "picks": [1, {"vehicle_id": 2, "reason": "x"}]}')
    assert (odd.message, odd.picks) == ("", [])


def test_error_names_and_versions() -> None:
    assert problem_for({"codexErrorInfo": "usageLimitExceeded"})[0] == "lane_usage_limit"
    assert problem_for({"codexErrorInfo": {"httpConnectionFailed": {}}})[0] == "lane_failed"
    assert problem_for(None)[0] == "lane_failed"
    assert parse_version("the_block_lane/0.163.0 (Mac OS)") == (0, 163, 0)
    assert parse_version("nothing") is None


def test_search_arguments_are_checked_like_the_run_list() -> None:
    assert search_query({"make": ["Ford"], "limit": 3}).page_size == 3
    with pytest.raises(ToolError, match="limit"):
        search_query({"limit": 500})
    with pytest.raises(ToolError, match="grade_min"):
        search_query({"grade_min": 9})
    with pytest.raises(ToolError, match="Extra inputs"):
        search_query({"colour": "red"})
