from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime, timezone
import os
import shutil


def _utcnow_naive() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def _resolve_database_url() -> str:
    """Keeps the SQLite DB on the persistent /data volume inside Docker so rebuilds never wipe edits/users.

    Override with the DATABASE_URL environment variable (e.g. a PostgreSQL URL).
    """
    env_url = os.environ.get('DATABASE_URL')
    if env_url:
        return env_url
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    legacy_db = os.path.join(backend_dir, 'osrm_portal.db')
    if os.path.exists('/.dockerenv') and os.path.isdir('/data'):
        persistent_db = '/data/osrm_portal.db'
        # One-time migration from the old in-image location (e.g. dev compose mounts ./backend:/app).
        if not os.path.exists(persistent_db) and os.path.exists(legacy_db):
            try:
                shutil.copy2(legacy_db, persistent_db)
            except Exception:
                return f'sqlite:///{legacy_db}'
        return f'sqlite:///{persistent_db}'
    return f'sqlite:///{legacy_db}'


DATABASE_URL = _resolve_database_url()

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False} if DATABASE_URL.startswith('sqlite') else {})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

class RoadOverride(Base):
    __tablename__ = "road_overrides"

    id = Column(Integer, primary_key=True, index=True)
    from_node = Column(String, index=True)
    to_node = Column(String, index=True)
    speed_kmh = Column(Float)
    is_closed = Column(Boolean, default=False)
    is_bidirectional = Column(Boolean, default=True)
    reason = Column(String, nullable=True)
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    geometry = Column(String, nullable=True)
    road_name = Column(String, nullable=True)
    city_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=_utcnow_naive)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String) # For simplicity, plaintext or simple hash here
    recovery_code = Column(String, nullable=True)

