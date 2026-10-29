"""Writes are committed before the client is told they succeeded."""

from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.clock import FrozenClock
from app.config import Settings
from app.main import create_app
from app.models import WatchlistEntry

from .conftest import DATA_PATH

ME = "browser-me-0001"


def test_watch_is_committed_before_the_response_is_sent(tmp_path: Path, clock: FrozenClock) -> None:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'tx.db'}", data_path=DATA_PATH, simulator_enabled=False
    )
    api = create_app(settings, clock)
    seen_at_send: list[bool] = []

    async def app(scope: Any, receive: Any, send: Any) -> None:
        async def observing_send(message: Any) -> None:
            if message["type"] == "http.response.start" and scope["method"] == "PUT":
                # What another request would see at the moment this response leaves the server.
                with Session(api.state.sessions.kw["bind"]) as other:
                    entry = other.get(WatchlistEntry, {"bidder_id": ME, "vehicle_id": vehicle_id})
                    seen_at_send.append(entry is not None)
            await send(message)

        await api(scope, receive, observing_send)

    with TestClient(app) as client:
        vehicle_id = client.get("/api/vehicles", params={"page_size": 1}).json()["items"][0]["id"]
        response = client.put(f"/api/me/watchlist/{vehicle_id}", headers={"X-Bidder-Id": ME})

    assert response.status_code == 204
    assert seen_at_send == [True]
