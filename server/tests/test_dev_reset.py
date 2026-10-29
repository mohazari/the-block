import sys
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import seed, serverlock
from app.clock import FrozenClock
from app.config import Settings
from app.main import create_app
from app.serverlock import DatabaseLock, ServerInfo, lock_path, read_server_info

from .conftest import DATA_PATH

ME = {"X-Bidder-Id": "browser-me-0001"}


def _settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'dev.db'}",
        data_path=DATA_PATH,
        simulator_enabled=False,
    )


def _run_cli(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *args: str) -> None:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'dev.db'}")
    monkeypatch.setattr(sys, "argv", ["app.seed", *args])
    seed.main()


def test_reset_needs_the_servers_token(tmp_path: Path, clock: FrozenClock) -> None:
    with TestClient(create_app(_settings(tmp_path), clock)) as client:
        assert client.post("/api/dev/reset").status_code == 403
        wrong = client.post("/api/dev/reset", headers={"X-Reset-Token": "guess"})
        assert wrong.status_code == 403


def test_reset_reseeds_in_process_and_every_client_hears_of_it(
    tmp_path: Path, clock: FrozenClock
) -> None:
    with TestClient(create_app(_settings(tmp_path), clock)) as client:
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
        token = {"X-Reset-Token": app.state.reset_token}
        assert client.post("/api/dev/reset", headers=token).status_code == 204

        assert app.state.data_epoch != epoch_before
        assert closed == [True]  # live streams end; reconnecting browsers get the new hello
        after = client.get(f"/api/vehicles/{vehicle['id']}")
        assert after.headers["X-Data-Epoch"] == app.state.data_epoch  # and so does every response
        assert after.json()["auction"]["bid_count"] == vehicle["auction"]["bid_count"]


def test_one_lock_per_database_file_however_it_is_spelled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    assert lock_path("sqlite:///dev.db") == lock_path(f"sqlite:///{tmp_path / 'dev.db'}")
    assert lock_path("sqlite:///:memory:") is None


def test_a_second_server_on_the_same_database_is_refused(
    tmp_path: Path, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(serverlock, "WAIT_FOR_LOCK_SECONDS", 0.2)
    first = TestClient(create_app(_settings(tmp_path), clock))
    second = TestClient(create_app(_settings(tmp_path), clock))
    with first, pytest.raises(RuntimeError, match="Another server is already using"), second:
        pass


def test_cli_resets_the_file_itself_when_no_server_uses_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    _run_cli(monkeypatch, tmp_path, "--reset")
    assert (tmp_path / "dev.db").exists()
    lock = DatabaseLock(lock_path(f"sqlite:///{tmp_path / 'dev.db'}"))
    assert lock.try_acquire()  # the CLI released it
    lock.release()


def test_cli_asks_the_server_using_the_database_and_never_touches_the_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    server = DatabaseLock(lock_path(f"sqlite:///{tmp_path / 'dev.db'}"))
    assert server.try_acquire()
    server.publish(ServerInfo(host="127.0.0.1", port=8123, token="secret"))
    asked: list[ServerInfo] = []
    monkeypatch.setattr(seed, "ask_server_to_reset", lambda info, _db: asked.append(info))

    def must_not_reset(*_args: object) -> None:
        raise AssertionError("reset the file under a running server")

    monkeypatch.setattr(seed, "reset", must_not_reset)
    _run_cli(monkeypatch, tmp_path, "--reset")
    assert asked == [ServerInfo(host="127.0.0.1", port=8123, token="secret")]
    server.release()


def test_cli_stops_instead_of_resetting_when_the_server_does_not_answer() -> None:
    # Port 9 (discard) on loopback: refused. The CLI must not fall back to a direct reset.
    with pytest.raises(SystemExit, match="Couldn't get an answer"):
        seed.ask_server_to_reset(ServerInfo("127.0.0.1", 9, "secret"), "dev.db")


def test_cli_wants_exactly_the_reset_endpoints_answer(monkeypatch: pytest.MonkeyPatch) -> None:
    class SomeOtherApp:  # answers 200 to anything
        status = 200

        def __enter__(self) -> "SomeOtherApp":
            return self

        def __exit__(self, *_args: object) -> None:
            return None

    class Opener:
        def open(self, request: Any, timeout: float) -> SomeOtherApp:
            assert request.headers["X-reset-token"] == "secret"
            return SomeOtherApp()

    monkeypatch.setattr(seed.urllib.request, "build_opener", lambda *_handlers: Opener())  # type: ignore[attr-defined]
    with pytest.raises(SystemExit, match="didn't reset"):
        seed.ask_server_to_reset(ServerInfo("127.0.0.1", 8123, "secret"), "dev.db")


def test_a_cli_without_a_server_address_explains_what_to_do() -> None:
    with pytest.raises(SystemExit, match="Stop it, then run this again"):
        seed.ask_server_to_reset(ServerInfo("127.0.0.1", None, "secret"), "dev.db")


def test_server_info_is_read_back_as_published(tmp_path: Path) -> None:
    lock = DatabaseLock(tmp_path / "x.db.server")
    assert lock.try_acquire()
    lock.publish(ServerInfo("127.0.0.1", 8000, "t"))
    assert read_server_info(tmp_path / "x.db.server") == ServerInfo("127.0.0.1", 8000, "t")
    lock.release()
