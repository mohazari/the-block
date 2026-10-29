import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI
from sqlalchemy.orm import sessionmaker

from app.clock import Clock, SystemClock
from app.config import Settings
from app.db import create_db_engine, write_engine
from app.errors import install_error_handlers
from app.events import EventBroker
from app.routers import bids, dev, events, me, vehicles
from app.seed import data_epoch, ensure_seeded
from app.simulator import RivalSimulator

logger = logging.getLogger(__name__)


def create_app(settings: Settings | None = None, clock: Clock | None = None) -> FastAPI:
    """App factory: tests pass their own settings (temp DB) and a frozen clock."""
    settings = settings or Settings.from_env()
    clock = clock or SystemClock()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        engine = create_db_engine(settings.database_url)
        ensure_seeded(engine, settings.data_path, clock.now())
        app.state.engine = engine
        app.state.clock = clock
        app.state.sessions = sessionmaker(engine, expire_on_commit=False)
        app.state.write_sessions = sessionmaker(write_engine(engine), expire_on_commit=False)
        app.state.broker = broker = EventBroker()
        broker.bind(asyncio.get_running_loop())
        # Identifies this copy of the data; sent with every hello (see routers/dev.py).
        app.state.data_epoch = data_epoch(engine)
        app.state.data_path = settings.data_path
        app.state.database_url = settings.database_url
        background: list[asyncio.Task[None]] = []

        if settings.simulator_enabled:
            simulator = RivalSimulator(
                app.state.sessions, app.state.write_sessions, clock, on_bid=broker.publish
            )
            background.append(asyncio.create_task(simulator.run()))
            logger.info("Rival bidder simulator running (SIMULATOR_ENABLED=0 to turn off)")
        yield
        for task in background:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task
        engine.dispose()

    app = FastAPI(title="The Block API", version="0.1.0", lifespan=lifespan)
    install_error_handlers(app)

    app.include_router(vehicles.router)
    app.include_router(bids.router)
    app.include_router(me.router)
    app.include_router(events.router)
    if settings.dev_reset_enabled:
        app.include_router(dev.router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


app = create_app()
