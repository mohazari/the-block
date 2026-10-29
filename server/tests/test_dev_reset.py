import urllib.error
import urllib.request
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.clock import FrozenClock
from app.config import Settings
from app.main import create_app
from app.seed import reset_running_server

from .conftest import DATA_PATH

ME = {"X-Bidder-Id": "browser-me-0001"}
URL = "http://127.0.0.1:8000/api/dev/reset"


def _client(tmp_path: Path, clock: FrozenClock, *, dev_reset: bool) -> TestClient:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'dev.db'}",
        data_path=DATA_PATH,
        simulator_enabled=False,
        dev_reset_enabled=dev_reset,
    )
    return TestClient(create_app(settings, clock))


def test_dev_reset_is_not_mounted_by_default(tmp_path: Path, clock: FrozenClock) -> None:
    with _client(tmp_path, clock, dev_reset=False) as client:
        assert client.post("/api/dev/reset").status_code == 404


def test_dev_reset_reseeds_in_process_and_ends_streams(tmp_path: Path, clock: FrozenClock) -> None:
    with _client(tmp_path, clock, dev_reset=True) as client:
        app: Any = client.app
        vehicle = client.get("/api/vehicles", params={"page_size": 1}).json()["items"][0]
        bid = client.post(
            f"/api/vehicles/{vehicle['id']}/bids",
            json={"amount": vehicle["auction"]["min_next_bid"]},
            headers=ME,
        )
        assert bid.status_code == 201
        epoch_before = app.state.data_epoch
        closed: list[bool] = []
        app.state.broker.close_all = lambda: closed.append(True)

        clock.advance(timedelta(minutes=1))  # a new seeding time, so a new epoch
        assert client.post("/api/dev/reset").status_code == 204

        assert app.state.data_epoch != epoch_before
        assert closed == [True]  # every live stream ends; browsers reconnect with the new epoch
        after = client.get(f"/api/vehicles/{vehicle['id']}").json()["auction"]
        assert after["bid_count"] == vehicle["auction"]["bid_count"]  # the new bid is gone


class _Accepted:
    def __enter__(self) -> "_Accepted":
        return self

    def __exit__(self, *_args: object) -> None:
        return None


def test_cli_asks_a_running_server_to_reseed(monkeypatch: pytest.MonkeyPatch) -> None:
    methods: list[str] = []

    def urlopen(request: urllib.request.Request, timeout: float) -> _Accepted:
        methods.append(request.method or "")
        return _Accepted()

    monkeypatch.setattr(urllib.request, "urlopen", urlopen)
    assert reset_running_server(URL) is True
    assert methods == ["POST"]


def test_cli_falls_back_when_no_server_is_running(monkeypatch: pytest.MonkeyPatch) -> None:
    def refused(*_args: object, **_kwargs: object) -> None:
        raise urllib.error.URLError(ConnectionRefusedError())

    monkeypatch.setattr(urllib.request, "urlopen", refused)
    assert reset_running_server(URL) is False


def test_cli_refuses_a_server_without_dev_reset(monkeypatch: pytest.MonkeyPatch) -> None:
    def not_found(*_args: object, **_kwargs: object) -> None:
        raise urllib.error.HTTPError(URL, 404, "Not Found", None, None)  # type: ignore[arg-type]

    monkeypatch.setattr(urllib.request, "urlopen", not_found)
    with pytest.raises(SystemExit, match="without dev reset"):
        reset_running_server(URL)
