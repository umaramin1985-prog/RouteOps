from sqlalchemy import create_engine, Column, Integer, String, Float, Boolean, DateTime
from sqlalchemy.orm import declarative_base, sessionmaker
from datetime import datetime

DATABASE_URL = "sqlite:///./osrm_portal.db"

engine = create_engine(DATABASE_URL, connect_args={"check_same_thread": False})
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
    created_at = Column(DateTime, default=datetime.utcnow)

class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String, unique=True, index=True)
    password = Column(String) # For simplicity, plaintext or simple hash here
    recovery_code = Column(String, nullable=True)

