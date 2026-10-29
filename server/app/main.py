from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from app.clock import Clock, SystemClock
from app.config import Settings
from app.db import create_db_engine, write_engine
from app.errors import install_error_handlers
from app.routers import vehicles
from app.seed import ensure_seeded


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    """App factory: tests pass their own settings (temp DB) and a frozen clock."""
    settings = settings or Settings.from_env()
    clock = clock or SystemClock()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_db_engine(settings.database_url)
        ensure_seeded(engine, settings.data_path, clock.now())
        app.state.clock = clock
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)
        app.state.write_sessions = sessionmaker(write_engine(engine), expire_on_commit=False)
        yield
        engine.dispose()

    app = FastAPI(title="The Block API", version="0.1.0", lifespan=lifespan)
    install_error_handlers(app)
    app.include_router(vehicles.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
