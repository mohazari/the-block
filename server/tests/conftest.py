from collections.abc import Iterator
from datetime import UTC, datetime
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine

from app.clock import FrozenClock
from app.config import REPO_DIR, Settings
from app.db import create_db_engine
from app.main import create_app
from app.seed import reset

DATA_PATH = REPO_DIR / "data" / "vehicles.json"
NOW = datetime(2026, 10, 28, 12, 0, tzinfo=UTC)


@pytest.fixture
def clock() -> FrozenClock:
    return FrozenClock(NOW)


@pytest.fixture
def engine(tmp_path: Path) -> Iterator[Engine]:
    engine = create_db_engine(f"sqlite:///{tmp_path / 'test.db'}")
    yield engine
    engine.dispose()


@pytest.fixture
def seeded_engine(engine: Engine, clock: FrozenClock) -> Engine:
    reset(engine, DATA_PATH, clock.now())
    return engine


@pytest.fixture
def client(tmp_path: Path, clock: FrozenClock) -> Iterator[TestClient]:
    settings = Settings(
        database_url=f"sqlite:///{tmp_path / 'api.db'}",
        data_path=DATA_PATH,
        simulator_enabled=False,
    )
    with TestClient(create_app(settings, clock)) as test_client:
        yield test_client
