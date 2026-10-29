from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.clock import FrozenClock
from app.config import Settings
from app.db import create_db_engine
from app.main import create_app
from app.models import Vehicle

from .conftest import DATA_PATH


def test_only_sqlite_urls_are_accepted() -> None:
    with pytest.raises(ValueError, match="Only SQLite"):
        Settings(
            database_url="postgresql://localhost/db", data_path=DATA_PATH, simulator_enabled=False
        )


def test_startup_seeds_an_empty_database(tmp_path: Path, clock: FrozenClock) -> None:
    url = f"sqlite:///{tmp_path / 'fresh.db'}"
    settings = Settings(database_url=url, data_path=DATA_PATH, simulator_enabled=False)

    with TestClient(create_app(settings, clock)) as client:
        assert client.get("/api/health").json() == {"status": "ok"}

    engine = create_db_engine(url)
    with Session(engine) as session:
        assert session.scalar(select(func.count()).select_from(Vehicle)) == 200
    engine.dispose()
