import asyncio
import sys
import time
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import seed, serverlock
from app.clock import FrozenClock
from app.config import Settings
from app.main import create_app
from app.serverlock import DatabaseLock, lock_path

from .conftest import DATA_PATH


def _settings(tmp_path: Path, data_path: Path = DATA_PATH) -> Settings:
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'dev.db'}",
        data_path=data_path,
        simulator_enabled=False,
    )


def _run_cli(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, *args: str) -> None:
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path / 'dev.db'}")
    monkeypatch.setattr(sys, "argv", ["app.seed", *args])
    seed.main()


def _lock_is_free(tmp_path: Path) -> bool:
    lock = DatabaseLock(lock_path(f"sqlite:///{tmp_path / 'dev.db'}"))
    free = lock.try_acquire()
    lock.release()
    return free


def test_one_lock_per_database_file_however_it_is_spelled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    assert lock_path("sqlite:///dev.db") == lock_path(f"sqlite:///{tmp_path / 'dev.db'}")
    assert lock_path("sqlite:///:memory:") is None


def test_reset_refuses_while_a_server_uses_the_database(
    tmp_path: Path, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    def must_not_reset(*_args: object) -> None:
        raise AssertionError("reset the file under a running server")

    monkeypatch.setattr(seed, "reset", must_not_reset)
    with TestClient(create_app(_settings(tmp_path), clock)):
        with pytest.raises(SystemExit, match="in use by a running server"):
            _run_cli(monkeypatch, tmp_path, "--reset")
        _run_cli(monkeypatch, tmp_path)  # plain seeding: leaves it to the server, no error


def test_reset_works_once_the_server_has_stopped(
    tmp_path: Path, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    with TestClient(create_app(_settings(tmp_path), clock)):
        pass
    _run_cli(monkeypatch, tmp_path, "--reset")
    assert _lock_is_free(tmp_path)  # and the CLI let go of it


def test_a_second_server_on_the_same_database_is_refused(
    tmp_path: Path, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(serverlock, "WAIT_FOR_LOCK_SECONDS", 0.2)
    first = TestClient(create_app(_settings(tmp_path), clock))
    second = TestClient(create_app(_settings(tmp_path), clock))
    with first, pytest.raises(RuntimeError, match="in use by another server"), second:
        pass


def test_a_server_that_fails_to_start_lets_go_of_the_database(
    tmp_path: Path, clock: FrozenClock
) -> None:
    broken = _settings(tmp_path, data_path=tmp_path / "missing.json")
    with pytest.raises(FileNotFoundError), TestClient(create_app(broken, clock)):
        pass
    assert _lock_is_free(tmp_path)


def test_responses_carry_the_epoch_read_at_startup(tmp_path: Path, clock: FrozenClock) -> None:
    with TestClient(create_app(_settings(tmp_path), clock)) as client:
        state: Any = client.app.state  # type: ignore[attr-defined]
        response = client.get("/api/vehicles", params={"page_size": 1})
        assert response.headers["X-Data-Epoch"] == state.data_epoch
        assert response.headers["X-Server-Run"] == state.run_id
        assert "X-Data-Epoch" not in client.get("/docs").headers  # API responses only


def test_unexpected_errors_carry_the_epoch_too(
    tmp_path: Path, clock: FrozenClock, monkeypatch: pytest.MonkeyPatch
) -> None:
    def crash(*_args: object, **_kwargs: object) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr("app.routers.vehicles.search_inventory", crash)
    app = create_app(_settings(tmp_path), clock)
    # See the 500 as a browser would, instead of re-raising it into the test.
    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/vehicles")
        assert response.status_code == 500
        assert response.headers["X-Data-Epoch"] == app.state.data_epoch
        assert response.headers["X-Server-Run"] == app.state.run_id


def test_a_server_shut_down_while_waiting_for_the_lock_never_keeps_it(
    tmp_path: Path, clock: FrozenClock
) -> None:
    """Cancels the real lifespan mid-wait: it must stop at once (not finish the wait in the
    background, which also holds up shutdown) and must not end up holding the lock."""
    holder = DatabaseLock(lock_path(f"sqlite:///{tmp_path / 'dev.db'}"))
    assert holder.try_acquire()
    app = create_app(_settings(tmp_path), clock)

    async def scenario() -> None:
        async def start() -> None:
            async with app.router.lifespan_context(app):
                raise AssertionError("started without the lock")

        starting = asyncio.ensure_future(start())
        await asyncio.sleep(0.3)  # waiting for the lock
        starting.cancel()
        with pytest.raises(asyncio.CancelledError):
            await starting

    started = time.monotonic()
    asyncio.run(scenario())  # also waits for the waiting thread to finish
    assert time.monotonic() - started < 2  # not the full WAIT_FOR_LOCK_SECONDS
    holder.release()
    assert _lock_is_free(tmp_path)
