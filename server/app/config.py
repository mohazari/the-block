import os
from dataclasses import dataclass
from pathlib import Path

SERVER_DIR = Path(__file__).resolve().parent.parent
REPO_DIR = SERVER_DIR.parent


def _env_flag(name: str, default: bool) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


@dataclass(frozen=True)
class Settings:
    database_url: str
    data_path: Path
    simulator_enabled: bool

    def __post_init__(self) -> None:
        # The engine setup (BEGIN IMMEDIATE, WAL, pragmas) is SQLite-specific by design.
        if not self.database_url.startswith("sqlite"):
            raise ValueError(f"Only SQLite is supported; got DATABASE_URL={self.database_url!r}")

    @classmethod
    def from_env(cls) -> "Settings":
        return cls(
            database_url=os.environ.get("DATABASE_URL", f"sqlite:///{SERVER_DIR / 'the_block.db'}"),
            data_path=Path(os.environ.get("DATA_PATH", REPO_DIR / "data" / "vehicles.json")),
            simulator_enabled=_env_flag("SIMULATOR_ENABLED", default=True),
        )
