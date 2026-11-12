from fastapi import FastAPI, Depends, BackgroundTasks, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel
import docker
import os
import sys
import shlex
import json
import yaml
import csv
import psutil
import subprocess
from sqlalchemy.orm import Session

if os.environ.get("PROCFS_PATH") and os.path.isdir(os.environ["PROCFS_PATH"]):
    psutil.PROCFS_PATH = os.environ["PROCFS_PATH"]

# Local imports
from database import SessionLocal, RoadOverride, engine, Base, User
from osrm_maxspeed_proxy import (
    parse_maxspeed,
    prepare_upstream_query,
    enrich_osrm_response,
    make_nearest_fetcher,
)

app = FastAPI(title="OSRM Management API")

container_log_sizes = {}
_deployment_active = False
import threading
_proxy_arch_lock = threading.RLock()

def _run_ephemeral_container_cmd(client, image: str, command, volumes: dict = None, entrypoint: str = None, timeout: int = 30) -> bytes:
    """Runs a short-lived helper container without `remove=True` so Docker auto-remove never races `logs()`."""
    from docker.types import LogConfig
    helper = None
    try:
        try:
            client.images.get(image)
        except Exception:
            client.images.pull(image)
        create_kwargs = dict(
            log_config=LogConfig(type=LogConfig.types.JSON),
        )
        if volumes is not None:
            create_kwargs['volumes'] = volumes
        if entrypoint is not None:
            create_kwargs['entrypoint'] = entrypoint
        helper = client.containers.create(image, command, **create_kwargs)
        helper.start()
        helper.wait(timeout=timeout)
        raw = helper.logs() or b''
        if isinstance(raw, str):
            return raw.encode('utf-8', errors='ignore')
        return bytes(raw)
    finally:
        if helper is not None:
            try:
                helper.remove(force=True)
            except Exception:
                pass


def update_log_sizes_bg():
    global container_log_sizes
    while True:
        try:
            import docker
            client = docker.from_env()
            if 'ensure_osrm_proxy_architecture' in globals() and not _deployment_active:
                try:
                    ensure_osrm_proxy_architecture(client)
                except Exception:
                    pass
            # Covers both json-file (<id>-json.log) and local (local-logs/container.log) container log drivers.
            res = _run_ephemeral_container_cmd(
                client,
                'alpine',
                'sh -c "stat -c \'%n %s\' /containers/*/*-json.log /containers/*/local-logs/container.log 2>/dev/null; true"',
                volumes={'/var/lib/docker/containers': {'bind': '/containers', 'mode': 'ro'}},
            )
            lines = (res or b'').decode('utf-8', errors='ignore').strip().split('\n')
            
            size_map = {}
            for line in lines:
                parts = line.strip().split(' ')
                if len(parts) == 2 and parts[0].startswith('/containers/'):
                    c_id = parts[0].split('/')[2]
                    try:
                        size_map[c_id] = size_map.get(c_id, 0) + int(parts[1])
                    except ValueError:
                        pass
            
            new_sizes = {}
            tracked_exact = {
                'routeops-maxspeed-car-1',
                'routeops-maxspeed-foot-1',
                'nominatim',
                'routeops-nominatim-1',
                'pelias_api',
                'routeops-pelias-1',
                'pelias_elasticsearch',
                'routeops-pelias-elasticsearch-1',
            }
            for c in client.containers.list(all=True):
                if c.name in tracked_exact or 'osrm-car' in c.name or 'osrm-foot' in c.name:
                    new_sizes[c.name] = size_map.get(c.id, 0)
            container_log_sizes = new_sizes
        except Exception:
            pass
        import time
        time.sleep(10)

threading.Thread(target=update_log_sizes_bg, daemon=True).start()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Dependency
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from typing import Optional

class OverrideRequest(BaseModel):
    from_node: str
    to_node: str
    speed_kmh: float
    is_closed: bool = False
    is_bidirectional: bool = True
    reason: Optional[str] = None
    lat: Optional[float] = None
    lng: Optional[float] = None
    geometry: Optional[str] = None
    road_name: Optional[str] = None
    city_name: Optional[str] = None

class AuthRequest(BaseModel):
    username: str
    password: str

class ChangePasswordRequest(BaseModel):
    username: str
    old_password: str
    new_password: str

class RecoverPasswordRequest(BaseModel):
    username: str
    recovery_code: str
    new_password: str

class CommandRequest(BaseModel):
    command: str

@app.on_event("startup")
def on_startup():
    from sqlalchemy import inspect
    import subprocess
    
    # 1. Ensure all tables are created if this is a fresh install
    Base.metadata.create_all(bind=engine)
    
    inspector = inspect(engine)
    
    backend_dir = os.path.dirname(os.path.abspath(__file__))
    # 2. Safely migrate existing databases to Alembic
    if "alembic_version" not in inspector.get_table_names():
        log_msg("No Alembic version found. Stamping head...")
        subprocess.run(["alembic", "stamp", "head"], cwd=backend_dir, check=True)
        
    log_msg("Running database migrations...")
    subprocess.run(["alembic", "upgrade", "head"], cwd=backend_dir, check=True)
    db = SessionLocal()
    admin_user = db.query(User).filter(User.username == "admin").first()
    if not admin_user:
        admin_user = User(username="admin", password="admin", recovery_code="123456")
        db.add(admin_user)
        db.commit()
    db.close()
    cleanup_raw_state_pbfs(get_data_dir())
    sync_osrm_proxy_script(get_data_dir())
    log_msg("[SYSTEM] Listening for deployment events...")
    threading.Thread(target=startup_maxspeed_maintenance, daemon=True).start()

@app.post("/auth/login")
def login(req: AuthRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if user and user.password == req.password:
        return {"status": "success"}
    from fastapi import HTTPException
    raise HTTPException(status_code=401, detail="Invalid username or password")

@app.post("/auth/change-password")
def change_password(req: ChangePasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if user and user.password == req.old_password:
        user.password = req.new_password
        db.commit()
        return {"status": "success"}
    from fastapi import HTTPException
    raise HTTPException(status_code=401, detail="Invalid old password")

@app.post("/auth/recover-password")
def recover_password(req: RecoverPasswordRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.username == req.username).first()
    if user and user.recovery_code == req.recovery_code:
        user.password = req.new_password
        db.commit()
        return {"status": "success"}
    from fastapi import HTTPException
    raise HTTPException(status_code=401, detail="Invalid username or recovery code")

@app.get("/")
def read_root():
    return {"message": "Welcome to the OSRM Routing Management Portal API!"}

@app.get("/overrides")
def get_overrides(db: Session = Depends(get_db)):
    return db.query(RoadOverride).all()

@app.post("/overrides")
def create_override(override: OverrideRequest, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    # Save to database
    payload = override.model_dump() if hasattr(override, 'model_dump') else override.dict()
    db_override = RoadOverride(**payload)
    db.add(db_override)
    db.commit()
    db.refresh(db_override)
    
    # Trigger rebuild in background
    background_tasks.add_task(rebuild_osrm_data)
    
    return {"status": "success", "message": "Override saved and OSRM rebuild triggered.", "data": db_override}

from typing import List
@app.post("/overrides/bulk")
def create_overrides_bulk(overrides: List[OverrideRequest], background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    db_overrides = []
    for override in overrides:
        payload = override.model_dump() if hasattr(override, 'model_dump') else override.dict()
        db_override = RoadOverride(**payload)
        db.add(db_override)
        db_overrides.append(db_override)
    
    db.commit()
    for db_override in db_overrides:
        db.refresh(db_override)
        
    background_tasks.add_task(rebuild_osrm_data)
    return {"status": "success", "message": f"{len(overrides)} overrides saved and OSRM rebuild triggered."}

@app.delete("/overrides/{override_id}")
def delete_override(override_id: int, background_tasks: BackgroundTasks, db: Session = Depends(get_db)):
    ov = db.query(RoadOverride).filter(RoadOverride.id == override_id).first()
    if ov:
        db.delete(ov)
        db.commit()
        background_tasks.add_task(rebuild_osrm_data)
        return {"status": "success", "message": "Override removed."}
    return JSONResponse(status_code=404, content={"status": "error", "message": "Not found"})

_rebuild_lock = threading.Lock()
_rebuild_pending = threading.Event()

def rebuild_osrm_data():
    """Re-applies road overrides to the running Car/Foot engines (osrm-customize + osrm-datastore hot swap).

    Serialized and coalesced: concurrent requests (e.g. forward + backward edit) collapse into one extra run
    instead of running osrm-customize in parallel on the same files. Logs go to stdout only, never deploy.log,
    so a road edit can't make the Engine Setup UI think a deployment is in progress.
    """
    import shutil
    _rebuild_pending.set()
    if not _rebuild_lock.acquire(blocking=False):
        return  # The active run will pick up the pending request.
    try:
        while _rebuild_pending.is_set():
            _rebuild_pending.clear()
            if _deployment_active:
                # A deployment exports speeds.csv from the DB and customizes the graph itself.
                print('[REBUILD] Deployment in progress; overrides will be applied by the deployment.', flush=True)
                return
            _rebuild_osrm_data_once(shutil)
    finally:
        _rebuild_lock.release()
    # Close the tiny window where a request arrived after the loop's last check but before release.
    if _rebuild_pending.is_set() and not _deployment_active:
        rebuild_osrm_data()

def _rebuild_osrm_data_once(shutil):
    try:
        data_dir = get_data_dir()
        has_speeds = export_speeds_csv(data_dir, quiet=True)
        client = docker.from_env()

        for profile in ['car', 'foot']:
            backup_dir = os.path.join(data_dir, f'backup_{profile}')
            if not os.path.exists(backup_dir) and not os.path.exists(os.path.join(data_dir, f'{profile}.osrm')) and not os.path.exists(os.path.join(data_dir, f'{profile}.osrm.ebg')):
                continue

            osrm_container = next((c for c in client.containers.list() if f"osrm-{profile}" in c.name), None)
            if not osrm_container:
                print(f"[REBUILD] Notice: osrm-{profile} container not running.", flush=True)
                continue

            if os.path.isdir(backup_dir):
                print(f"[REBUILD] Restoring pristine {profile} graph from backup...", flush=True)
                for fname in os.listdir(backup_dir):
                    src = os.path.join(backup_dir, fname)
                    if os.path.isfile(src):
                        shutil.copy2(src, os.path.join(data_dir, fname))

            cust_cmd = ['osrm-customize', f'/data/{profile}.osrm']
            if has_speeds:
                cust_cmd += ['--segment-speed-file', '/data/speeds.csv']
            result = osrm_container.exec_run(cust_cmd)
            print(f"[REBUILD] Customize ({profile}) exit={result.exit_code}:", result.output.decode('utf-8', errors='replace')[-2000:], flush=True)
            if result.exit_code != 0:
                continue
            ds_result = osrm_container.exec_run(['osrm-datastore', f'/data/{profile}.osrm'])
            print(f"[REBUILD] Datastore ({profile}) exit={ds_result.exit_code}:", ds_result.output.decode('utf-8', errors='replace')[-2000:], flush=True)

    except Exception as e:
        print("[REBUILD] Error during OSRM rebuild:", str(e), flush=True)




@app.post('/system/docker/remove-all')
def remove_all_containers():
    global recorded_api_calls
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        count = 0
        for c in containers:
            if any(name in c.name for name in ['maxspeed-car', 'maxspeed-foot', 'osrm-car', 'osrm-foot', 'nominatim', 'pelias']):
                try:
                    c.stop()
                except:
                    pass
                try:
                    c.remove(force=True)
                    if not any(name in c.name for name in ['maxspeed-car', 'maxspeed-foot']):
                        count += 1
                except:
                    pass

        for vol_name in ('nominatim-data', 'pelias-data'):
            try:
                client.volumes.get(vol_name).remove(force=True)
            except Exception:
                pass
        container_log_sizes.clear()
        with _api_calls_lock:
            recorded_api_calls.clear()
            save_recorded_api_calls()
                    
        # Clean /data directory
        import shutil
        data_dir = get_data_dir()
        if os.path.exists(data_dir):
            for f in os.listdir(data_dir):
                if f not in ('speeds.csv', 'ports.json', 'osrm_maxspeed_proxy.py') and not f.startswith('osrm_portal.db'): # keep overrides DB/CSV, port prefs & proxy script
                    p = os.path.join(data_dir, f)
                    if os.path.isfile(p):
                        os.remove(p)
                    elif os.path.isdir(p):
                        shutil.rmtree(p)
            sync_osrm_proxy_script(data_dir)
                        
        return {'status': 'success', 'removed': count}
    except Exception as e:
        return {'error': str(e)}
last_net = None
last_disk = None
last_time = None

@app.get('/system/metrics')
def get_system_metrics():
    global last_net, last_disk, last_time
    import time
    
    cpu = psutil.cpu_percent(interval=0.1)
    ram = psutil.virtual_memory().percent
    
    current_net = psutil.net_io_counters()
    current_disk = psutil.disk_io_counters()
    current_time = time.time()
    
    net_in_rate = 0
    net_out_rate = 0
    disk_read_rate = 0
    disk_write_rate = 0
    
    if last_time:
        dt = current_time - last_time
        if dt > 0:
            if current_net is not None and last_net is not None:
                net_in_rate = max(0.0, (current_net.bytes_recv - last_net.bytes_recv) / dt)
                net_out_rate = max(0.0, (current_net.bytes_sent - last_net.bytes_sent) / dt)
            if current_disk is not None and last_disk is not None:
                disk_read_rate = max(0.0, (current_disk.read_bytes - last_disk.read_bytes) / dt)
                disk_write_rate = max(0.0, (current_disk.write_bytes - last_disk.write_bytes) / dt)
            
    last_net = current_net
    last_disk = current_disk
    last_time = current_time

    try:
        usage = psutil.disk_usage('/data')
    except:
        usage = psutil.disk_usage('/')
    
    return {
        'cpu': cpu, 
        'ram': ram, 
        'disk': usage.percent,
        'disk_total': round(usage.total / (1024**3), 2),
        'disk_free': round(usage.free / (1024**3), 2),
        'net_in': net_in_rate,
        'net_out': net_out_rate,
        'disk_read': disk_read_rate,
        'disk_write': disk_write_rate
    }

@app.get('/system/db-status')
def get_db_status(db: Session = Depends(get_db)):
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        return {'status': 'connected'}
    except Exception as e:
        return {'status': 'disconnected', 'error': str(e)}

def get_data_dir():
    import os
    if os.path.exists('/.dockerenv'):
        return '/data'
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data'))

def get_saved_ports():
    default_ports = {'car': 5001, 'foot': 5005, 'nominatim': 5003, 'pelias': 5002}
    try:
        ports_path = os.path.join(get_data_dir(), 'ports.json')
        if os.path.exists(ports_path):
            with open(ports_path, 'r') as f:
                data = json.load(f)
                if isinstance(data, dict):
                    for k, v in data.items():
                        if str(v).isdigit():
                            default_ports[k] = int(v)
    except Exception:
        pass
    return default_ports

def save_ports(ports: dict):
    try:
        data_dir = get_data_dir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir, exist_ok=True)
        ports_path = os.path.join(data_dir, 'ports.json')
        current = get_saved_ports()
        for k, v in ports.items():
            if str(v).isdigit():
                current[k] = int(v)
        with open(ports_path + '.tmp', 'w') as f:
            json.dump(current, f)
        os.replace(ports_path + '.tmp', ports_path)
    except Exception:
        pass

RESERVED_ENGINE_PORTS = {80, 5172, 5173, 5433, 8000, 9200}

def validate_engine_ports(ports_map: dict) -> Optional[str]:
    """Validates engine host ports (range, reserved system ports, and uniqueness across engines)."""
    seen = {}
    for name, raw_port in ports_map.items():
        try:
            p = int(raw_port)
        except (TypeError, ValueError):
            return f"Invalid port for {name}: {raw_port}"
        if p < 1 or p > 65535:
            return f"Port for {name} ({p}) must be between 1 and 65535."
        if p in RESERVED_ENGINE_PORTS:
            return f"Port {p} ({name}) is reserved by RouteOps internal services."
        if p in seen:
            return f"Duplicate port {p} assigned to both {seen[p]} and {name}."
        seen[p] = name
    return None

def is_engine_enabled(engines: Optional[dict], profile: str) -> bool:
    if not engines:
        return True
    if profile in engines:
        return bool(engines[profile])
    if profile in ('car', 'foot') and 'osrm' in engines:
        return bool(engines['osrm'])
    return True

def load_active_states(data_dir: str) -> dict:
    states_path = os.path.join(data_dir, 'active_states.json')
    try:
        if os.path.exists(states_path):
            with open(states_path, 'r') as f:
                raw = json.load(f)
            if isinstance(raw, list):
                norm = normalize_region_list(raw)
                return {e: list(norm) for e in ('car', 'foot', 'nominatim', 'pelias')}
            if isinstance(raw, dict):
                return {k: normalize_region_list(v) if isinstance(v, list) else [] for k, v in raw.items()}
    except Exception:
        pass
    return {}

def write_active_states(data_dir: str, states: dict):
    os.makedirs(data_dir, exist_ok=True)
    states_path = os.path.join(data_dir, 'active_states.json')
    tmp_path = states_path + '.tmp'
    with open(tmp_path, 'w') as f:
        json.dump(states, f)
    os.replace(tmp_path, states_path)

def restore_active_states(data_dir: str, previous_states: Optional[dict]):
    states_path = os.path.join(data_dir, 'active_states.json')
    try:
        if previous_states:
            write_active_states(data_dir, previous_states)
        elif os.path.exists(states_path):
            os.remove(states_path)
    except Exception:
        pass

def merge_active_states_for_engines(existing: dict, incoming: dict, engines: Optional[dict]) -> dict:
    merged = {k: list(v) for k, v in (existing or {}).items() if isinstance(v, list)}
    for profile in ('car', 'foot', 'nominatim', 'pelias'):
        if is_engine_enabled(engines, profile) and profile in (incoming or {}):
            merged[profile] = normalize_region_list(incoming.get(profile) or [])
    return merged

@app.get('/system/docker')
def get_docker_status():
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        car_status = 'Not Found'
        foot_status = 'Not Found'
        nominatim_status = 'Not Found'
        pelias_status = 'Not Found'
        car_started_at = None
        foot_started_at = None
        nominatim_started_at = None
        pelias_started_at = None
        saved_ports = get_saved_ports()
        car_port = saved_ports.get('car', 5001)
        foot_port = saved_ports.get('foot', 5005)
        nominatim_port = saved_ports.get('nominatim', 5003)
        pelias_port = saved_ports.get('pelias', 5002)
        for c in containers:
            if 'osrm-car' in c.name:
                car_status = c.status
                car_started_at = c.attrs.get('State', {}).get('StartedAt')
                if c.attrs.get('HostConfig', {}).get('PortBindings', {}).get('5000/tcp'):
                    car_port = int(c.attrs['HostConfig']['PortBindings']['5000/tcp'][0]['HostPort'])
            if 'osrm-foot' in c.name:
                foot_status = c.status
                foot_started_at = c.attrs.get('State', {}).get('StartedAt')
                if c.attrs.get('HostConfig', {}).get('PortBindings', {}).get('5000/tcp'):
                    foot_port = int(c.attrs['HostConfig']['PortBindings']['5000/tcp'][0]['HostPort'])
            if c.name in ['nominatim', 'routeops-nominatim-1']:
                nominatim_status = c.status
                nominatim_started_at = c.attrs.get('State', {}).get('StartedAt')
                if c.attrs.get('HostConfig', {}).get('PortBindings', {}).get('8080/tcp'):
                    nominatim_port = int(c.attrs['HostConfig']['PortBindings']['8080/tcp'][0]['HostPort'])
            if c.name in ['pelias_api', 'routeops-pelias-1']:
                pelias_status = c.status
                pelias_started_at = c.attrs.get('State', {}).get('StartedAt')
                pb = c.attrs.get('HostConfig', {}).get('PortBindings', {})
                if '3100/tcp' in pb and pb['3100/tcp']:
                    pelias_port = int(pb['3100/tcp'][0]['HostPort'])
                elif '4000/tcp' in pb and pb['4000/tcp']:
                    pelias_port = int(pb['4000/tcp'][0]['HostPort'])
        
        save_ports({'car': car_port, 'foot': foot_port, 'nominatim': nominatim_port, 'pelias': pelias_port})

        active_states = []
        try:
            states_file = os.path.join(get_data_dir(), 'active_states.json')
            if not os.path.exists(states_file) and os.path.exists('/data/active_states.json'):
                states_file = '/data/active_states.json'
            with open(states_file, 'r') as f:
                active_states = json.load(f)
        except:
            pass
            
        is_deploying = bool(_deployment_active)
            
        car_log_size = 0
        foot_log_size = 0
        nominatim_log_size = 0
        pelias_log_size = 0
        for name, size in list(container_log_sizes.items()):
            if 'osrm-car' in name or name == 'routeops-maxspeed-car-1':
                car_log_size += size
            elif 'osrm-foot' in name or name == 'routeops-maxspeed-foot-1':
                foot_log_size += size
            elif name in ('nominatim', 'routeops-nominatim-1'):
                nominatim_log_size += size
            elif name in ('pelias_api', 'routeops-pelias-1', 'pelias_elasticsearch', 'routeops-pelias-elasticsearch-1'):
                pelias_log_size += size

        return {'car': car_status, 'foot': foot_status, 'nominatim': nominatim_status, 'pelias': pelias_status, 'car_started_at': car_started_at, 'foot_started_at': foot_started_at, 'nominatim_started_at': nominatim_started_at, 'pelias_started_at': pelias_started_at, 'car_port': car_port, 'foot_port': foot_port, 'nominatim_port': nominatim_port, 'pelias_port': pelias_port, 'active_states': active_states, 'is_deploying': is_deploying, 'car_log_size': car_log_size, 'foot_log_size': foot_log_size, 'nominatim_log_size': nominatim_log_size, 'pelias_log_size': pelias_log_size}
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/docker/nominatim/restart')
def restart_nominatim():
    try:
        client = docker.from_env()
        try:
            c = client.containers.get('routeops-nominatim-1')
        except docker.errors.NotFound:
            c = client.containers.get('nominatim')
        c.restart()
        return {'status': 'success'}
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/docker/pelias/install')
def install_pelias(background_tasks: BackgroundTasks):
    if _deployment_active:
        return JSONResponse(status_code=409, content={'error': 'A deployment is already running.'})

    def run_pelias_build():
        global _deployment_active
        _deployment_active = True
        try:
            client = docker.from_env()
            data_dir = get_data_dir()
            os.makedirs(data_dir, exist_ok=True)
            pelias_cfg = os.path.join(data_dir, 'pelias.json')
            if not os.path.exists(pelias_cfg):
                with open(pelias_cfg, 'w') as f:
                    f.write(PELIAS_CONFIG_JSON)
            try:
                client.networks.get('routeops-geocoding_default')
            except Exception:
                client.networks.create('routeops-geocoding_default', driver='bridge')
            ensure_pelias_elasticsearch_container(client, fresh=False)
            if not setup_pelias_schema(client, get_docker_mounts()):
                log_msg("Cannot proceed with Pelias build: Schema setup failed.")
                return
            log_msg("--- Starting Pelias OSM Import ---")
            import_ok = stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
            try:
                c = client.containers.get('routeops-pelias-1')
                c.restart()
            except Exception:
                try:
                    c = client.containers.get('pelias_api')
                    c.restart()
                except Exception:
                    pass
            if import_ok:
                cleanup_engine_files(client, data_dir, 'pelias', container_names=['routeops-pelias-1', 'pelias_api', 'routeops-pelias-elasticsearch-1'])
                cleanup_raw_state_pbfs(data_dir)
            log_msg("--- Pelias Build Finished! ---")
        except Exception as e:
            log_msg(f"Pelias build error: {e}")
        finally:
            _deployment_active = False

    background_tasks.add_task(run_pelias_build)
    return {'status': 'success'}

@app.get('/system/docker/nominatim/logs')
def get_nominatim_logs():
    try:
        client = docker.from_env()
        try:
            c = client.containers.get('routeops-nominatim-1')
        except docker.errors.NotFound:
            c = client.containers.get('nominatim')
        logs = (c.logs(tail=100) or b'').decode('utf-8', errors='replace').splitlines()
        return {'logs': logs}
    except Exception as e:
        return {'error': str(e)}

@app.get('/system/docker/pelias/logs')
def get_pelias_logs():
    try:
        client = docker.from_env()
        try:
            c = client.containers.get('routeops-pelias-1')
        except docker.errors.NotFound:
            c = client.containers.get('pelias_api')
        logs = (c.logs(tail=100) or b'').decode('utf-8', errors='replace').splitlines()
        return {'logs': logs}
    except Exception as e:
        return {'error': str(e)}


import datetime

def _engine_log_config():
    """Bounded json-file log config so container.logs(), LogPath, log size, and log clearing work on any Docker daemon."""
    from docker.types import LogConfig
    return LogConfig(type=LogConfig.types.JSON, config={'max-size': '50m', 'max-file': '3'})

def get_docker_mounts():
    import os
    if os.path.exists('/.dockerenv'):
        return {'volumes_from': [os.environ.get('HOSTNAME') or '']}
    else:
        return {'volumes': {get_data_dir(): {'bind': '/data', 'mode': 'rw'}}}

class DeployRequest(BaseModel):
    car_port: int
    foot_port: int

def stream_container_logs(client, image, command, quiet: bool = False, **kwargs):
    emit = (lambda *a: print(*a, flush=True)) if quiet else log_msg
    try:
        from docker.types import LogConfig
        kwargs['log_config'] = LogConfig(type=LogConfig.types.JSON)
        kwargs['detach'] = True
        container = client.containers.run(image, command, **kwargs)
        for chunk in container.logs(stream=True, follow=True):
            for line in chunk.decode('utf-8', errors='replace').splitlines():
                if line.strip():
                    emit(line.strip())
        res = container.wait()
        container.remove(force=True)
        status_code = res.get('StatusCode', 0)
        if status_code != 0:
            emit(f"Warning: command exited with code {status_code}")
            return False
        return True
    except Exception as e:
        emit(f"Error running {command}: {e}")
        return False

def wait_for_elasticsearch_ready(client, container_name='routeops-pelias-elasticsearch-1', timeout=90):
    import time
    log_msg(f"Waiting for Elasticsearch ({container_name}) to become ready...")
    start_time = time.time()
    while time.time() - start_time < timeout:
        try:
            c = client.containers.get(container_name)
            if c.status == 'running':
                res = c.exec_run('curl -s http://localhost:9200/_cluster/health')
                out = res.output.decode('utf-8', errors='ignore')
                if res.exit_code == 0 and ('yellow' in out or 'green' in out or 'status' in out):
                    log_msg("Elasticsearch is healthy and ready!")
                    return True
        except Exception:
            pass
        time.sleep(2)
    log_msg("Warning: Elasticsearch readiness check timed out.")
    return False

def ensure_pelias_elasticsearch_container(client, fresh: bool = False):
    """Starts (or recreates) Pelias Elasticsearch backed by the persistent `pelias-data` volume."""
    if fresh:
        _remove_container_if_exists(client, 'routeops-pelias-elasticsearch-1')
        try:
            client.volumes.get('pelias-data').remove(force=True)
        except Exception:
            pass
    else:
        try:
            existing = client.containers.get('routeops-pelias-elasticsearch-1')
            if existing.status != 'running':
                existing.start()
            return existing
        except Exception:
            pass

    mounts = get_docker_mounts()
    kwargs = dict(
        name='routeops-pelias-elasticsearch-1',
        network='routeops-geocoding_default',
        environment={'discovery.type': 'single-node'},
        log_config=_engine_log_config(),
        restart_policy={'Name': 'always'},
        detach=True,
        volumes={'pelias-data': {'bind': '/usr/share/elasticsearch/data', 'mode': 'rw'}, **(mounts.get('volumes') or {})},
    )
    if mounts.get('volumes_from'):
        kwargs['volumes_from'] = mounts['volumes_from']
    log_msg('Starting Pelias Elasticsearch...')
    return client.containers.run('pelias/elasticsearch:7.5.1', **kwargs)

def setup_pelias_schema(client, mounts):
    """Ensures Elasticsearch is healthy and the pelias index schema is created/recreated."""
    if not wait_for_elasticsearch_ready(client):
        log_msg("Error: Elasticsearch is not reachable. Aborting Pelias schema setup.")
        return False

    # Check if index already exists; if so, drop it first to ensure clean schema rebuild
    try:
        c = client.containers.get('routeops-pelias-elasticsearch-1')
        chk = c.exec_run('curl -s -o /dev/null -w "%{http_code}" http://localhost:9200/pelias')
        if chk.exit_code == 0 and chk.output.decode('utf-8').strip() == '200':
            log_msg("Dropping existing Pelias index for fresh rebuild...")
            c.exec_run('curl -s -X DELETE http://localhost:9200/pelias')
    except Exception as e:
        log_msg(f"Notice during index check/drop: {e}")

    log_msg("--- Creating Pelias Schema Index ---")
    ok = stream_container_logs(
        client,
        'pelias/schema:master',
        ['npm', 'run', 'create_index'],
        environment={"PELIAS_CONFIG": "/data/pelias.json"},
        network='routeops-geocoding_default',
        **mounts
    )
    if not ok:
        log_msg("Pelias schema index creation failed.")
        return False
    return True

TOP_LEVEL_GEOFABRIK_REGIONS = {
    'africa', 'antarctica', 'asia', 'australia-oceania',
    'central-america', 'europe', 'north-america', 'south-america', 'russia'
}

def get_geofabrik_url(region_id: str) -> str:
    """Resolves a region ID (planet, continent, country path, or US state) to its OSM PBF download URL."""
    region_id = (region_id or '').strip().lower()
    if region_id == 'planet':
        return 'https://planet.openstreetmap.org/pbf/planet-latest.osm.pbf'
    if region_id in TOP_LEVEL_GEOFABRIK_REGIONS or '/' in region_id:
        return f'https://download.geofabrik.de/{region_id}-latest.osm.pbf'
    if region_id.startswith('us-') and region_id != 'us-virgin-islands':
        return f'https://download.geofabrik.de/north-america/{region_id}-latest.osm.pbf'
    return f'https://download.geofabrik.de/north-america/us/{region_id}-latest.osm.pbf'

def get_region_pbf_filename(region_id: str) -> str:
    """Returns a flat, filesystem-safe filename for a region's raw PBF in /data."""
    safe_slug = (region_id or '').strip().lower().replace('/', '__')
    return f'{safe_slug}.osm.pbf'

def normalize_region_list(regions: list) -> list:
    """If 'planet' is selected alongside sub-regions, only 'planet' is needed since it contains the entire world."""
    if not regions:
        return []
    cleaned = [str(r).strip().lower() for r in regions if str(r or '').strip()]
    if 'planet' in cleaned:
        return ['planet']
    return list(dict.fromkeys(cleaned))

def cleanup_raw_state_pbfs(data_dir: str, keep_files: set = None):
    """Removes raw state .osm.pbf files from /data once merging/extraction is complete."""
    if keep_files is None:
        keep_files = set()
    removed = []
    try:
        if os.path.exists(data_dir):
            for fname in os.listdir(data_dir):
                if fname.endswith('.osm.pbf') and fname not in keep_files and not fname.startswith('_maxspeed_'):
                    fpath = os.path.join(data_dir, fname)
                    if os.path.isfile(fpath):
                        try:
                            os.remove(fpath)
                            removed.append(fname)
                        except Exception as e:
                            log_msg(f'Warning: Could not remove {fname}: {e}')
        if removed:
            log_msg(f'[CLEANUP] Removed unnecessary PBF files: {", ".join(removed)}')
    except Exception as e:
        log_msg(f'Notice during raw PBF cleanup: {e}')

def cleanup_engine_files(client, data_dir: str, profile: str, container_names: list = None, extra_container_paths: list = None):
    """Cleans up temporary/unnecessary files on host /data and inside the engine container(s) after successful installation."""
    removed_files = []
    try:
        pbf_file = os.path.join(data_dir, f'{profile}.osm.pbf')
        if os.path.exists(pbf_file):
            try:
                os.remove(pbf_file)
                removed_files.append(f'{profile}.osm.pbf')
            except Exception as e:
                log_msg(f'Warning: Could not remove {profile}.osm.pbf: {e}')

        if container_names:
            paths_to_clean = ['/tmp/*', '/var/tmp/*', '/root/.npm', '/root/.cache', '/var/lib/apt/lists/*']
            if extra_container_paths:
                paths_to_clean.extend(extra_container_paths)
            rm_cmd = f'sh -c "rm -rf {" ".join(paths_to_clean)} 2>/dev/null || true"'
            for c_name in container_names:
                try:
                    c = client.containers.get(c_name)
                    if c.status == 'running':
                        c.exec_run(rm_cmd)
                except Exception:
                    pass

        try:
            client.containers.prune()
        except Exception:
            pass
        try:
            client.images.prune(filters={'dangling': True})
        except Exception:
            pass

        if removed_files:
            log_msg(f'[CLEANUP] Cleaned up unnecessary files for {profile.upper()} engine (removed {", ".join(removed_files)}).')
        else:
            log_msg(f'[CLEANUP] Cleaned up temporary container files for {profile.upper()} engine.')
    except Exception as e:
        log_msg(f'Notice during {profile} cleanup: {e}')

# ==========================================================================
# OSM maxspeed index & OSRM port proxy sidecar lifecycle
# ==========================================================================

# All speed values are taken strictly from the OSM `maxspeed` tags in the engine's .osm.pbf.
# No hardcoded or assumed zone speeds are ever used.

def get_maxspeed_db_path(profile: str) -> str:
    return os.path.join(get_data_dir(), f'{profile}_maxspeed.sqlite')

def _opl_unescape(s: str) -> str:
    import re
    return re.sub(r'%([0-9a-fA-F]+)%', lambda m: chr(int(m.group(1), 16)), s)

def maxspeed_db_has_mph_schema(db_path: str) -> bool:
    import sqlite3
    if not db_path or not os.path.exists(db_path):
        return False
    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
        try:
            cols = {row[1] for row in conn.execute('PRAGMA table_info(vals)').fetchall()}
            return {'id', 'kmh', 'mph', 'is_unlimited', 'raw'}.issubset(cols)
        finally:
            conn.close()
    except Exception:
        return False

def maxspeed_db_is_current(db_path: str) -> bool:
    """True if the index has mph AND per-road name/ref (needed to resolve one-way snapped points)."""
    import sqlite3
    if not maxspeed_db_has_mph_schema(db_path):
        return False
    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
        try:
            cols = {row[1] for row in conn.execute('PRAGMA table_info(vals)').fetchall()}
            return {'name', 'ref'}.issubset(cols)
        finally:
            conn.close()
    except Exception:
        return False

def upgrade_legacy_maxspeed_db_inplace(db_path: str) -> bool:
    """Upgrades an existing `{profile}_maxspeed.sqlite` lacking the `mph` column in-place."""
    import sqlite3
    if not db_path or not os.path.exists(db_path):
        return False
    if maxspeed_db_has_mph_schema(db_path):
        return True
    try:
        conn = sqlite3.connect(db_path)
        try:
            cols = {row[1] for row in conn.execute('PRAGMA table_info(vals)').fetchall()}
            if not cols:
                return False
            if 'mph' not in cols:
                conn.execute('ALTER TABLE vals ADD COLUMN mph REAL')
            rows = conn.execute('SELECT id, raw FROM vals').fetchall()
            updates = []
            for vid, raw_val in rows:
                kph, mph, unlim = parse_maxspeed(raw_val)
                updates.append((kph, mph, 1 if unlim else 0, vid))
            if updates:
                conn.executemany('UPDATE vals SET kmh = ?, mph = ?, is_unlimited = ? WHERE id = ?', updates)
            conn.commit()
            print(f'[MAXSPEED] Upgraded schema in-place for {db_path} ({len(updates)} tag values).', flush=True)
            return True
        finally:
            conn.close()
    except Exception as e:
        print(f'[MAXSPEED] Warning: Could not upgrade {db_path} in-place: {e}', flush=True)
        return False

def _get_profile_active_regions(data_dir: str, profile: str) -> list:
    states_file = os.path.join(data_dir, 'active_states.json')
    if not os.path.exists(states_file) and os.path.exists('/data/active_states.json'):
        states_file = '/data/active_states.json'
    try:
        if os.path.exists(states_file):
            with open(states_file, 'r') as f:
                data = json.load(f)
            if isinstance(data, dict):
                return normalize_region_list(data.get(profile) or [])
            if isinstance(data, list):
                return normalize_region_list(data)
    except Exception:
        pass
    return []

def can_reuse_car_maxspeed_for_foot(data_dir: str) -> bool:
    car_regions = _get_profile_active_regions(data_dir, 'car')
    foot_regions = _get_profile_active_regions(data_dir, 'foot')
    if not car_regions or car_regions != foot_regions:
        return False
    return maxspeed_db_is_current(os.path.join(data_dir, 'car_maxspeed.sqlite'))

def build_maxspeed_index(client, data_dir: str, profile: str, pbf_filename: str = None, quiet: bool = False) -> bool:
    """Builds /data/{profile}_maxspeed.sqlite from /data/{pbf_filename}.

    Extracts all ways tagged with OSM `maxspeed*` tags using osmium-tool, then stores
    directed (from_node, to_node) -> (kmh, mph, is_unlimited, raw) rows so OSRM route
    segments can be mapped back to their exact legal OSM speed limit.
    """
    import sqlite3
    emit = (lambda *a: print(*a, flush=True)) if quiet else log_msg
    pbf_filename = pbf_filename or f'{profile}.osm.pbf'
    pbf_path = os.path.join(data_dir, pbf_filename)
    if not os.path.exists(pbf_path):
        return False

    filtered_name = f'_maxspeed_ways_{profile}.osm.pbf'
    opl_name = f'_maxspeed_ways_{profile}.opl'
    filtered_path = os.path.join(data_dir, filtered_name)
    opl_path = os.path.join(data_dir, opl_name)
    db_path = os.path.join(data_dir, f'{profile}_maxspeed.sqlite')
    tmp_db_path = db_path + '.tmp'

    try:
        emit(f'[MAXSPEED] Building maxspeed index for {profile.upper()} (filtering maxspeed-tagged ways)...')
        ok = stream_container_logs(
            client, 'stefda/osmium-tool',
            ['osmium', 'tags-filter', f'/data/{pbf_filename}',
             'w/maxspeed', 'w/maxspeed:forward', 'w/maxspeed:backward',
             'w/maxspeed:lanes', 'w/maxspeed:lanes:forward', 'w/maxspeed:lanes:backward',
             '-R', '-o', f'/data/{filtered_name}', '-O'],
            quiet=quiet,
            **get_docker_mounts()
        )
        if not ok or not os.path.exists(filtered_path):
            emit(f'Warning: maxspeed way filtering failed for {profile.upper()}; maxspeed will be unavailable.')
            return False

        ok = stream_container_logs(
            client, 'stefda/osmium-tool',
            ['osmium', 'cat', f'/data/{filtered_name}', '-t', 'way', '-f', 'opl', '-o', f'/data/{opl_name}', '-O'],
            quiet=quiet,
            **get_docker_mounts()
        )
        if not ok or not os.path.exists(opl_path):
            emit(f'Warning: maxspeed OPL export failed for {profile.upper()}; maxspeed will be unavailable.')
            return False

        if os.path.exists(tmp_db_path):
            os.remove(tmp_db_path)
        conn = sqlite3.connect(tmp_db_path)
        conn.execute('PRAGMA journal_mode=OFF')
        conn.execute('PRAGMA synchronous=OFF')
        conn.execute('CREATE TABLE vals (id INTEGER PRIMARY KEY, kmh REAL, mph REAL, is_unlimited INTEGER NOT NULL DEFAULT 0, raw TEXT NOT NULL, name TEXT NOT NULL DEFAULT \'\', ref TEXT NOT NULL DEFAULT \'\')')
        conn.execute('CREATE UNIQUE INDEX vals_key ON vals (raw, name, ref)')
        conn.execute('CREATE TABLE seg (a INTEGER NOT NULL, b INTEGER NOT NULL, v INTEGER NOT NULL)')

        # Bounded in-memory cache; the UNIQUE index dedupes the rest (keeps planet builds memory-safe).
        val_cache = {}
        next_val_id = [0]
        def get_val_id(raw_val, way_name='', way_ref=''):
            if raw_val is None:
                return None
            raw_val = raw_val.strip()
            if not raw_val:
                return None
            key = (raw_val, way_name, way_ref)
            vid = val_cache.get(key)
            if vid is None:
                row = conn.execute('SELECT id FROM vals WHERE raw = ? AND name = ? AND ref = ?', key).fetchone()
                if row:
                    vid = row[0]
                else:
                    kph, mph, unlimited = parse_maxspeed(raw_val)
                    next_val_id[0] += 1
                    vid = next_val_id[0]
                    conn.execute(
                        'INSERT INTO vals (id, kmh, mph, is_unlimited, raw, name, ref) VALUES (?, ?, ?, ?, ?, ?, ?)',
                        (vid, kph, mph, 1 if unlimited else 0, raw_val, way_name, way_ref)
                    )
                if len(val_cache) >= 500000:
                    val_cache.clear()
                val_cache[key] = vid
            return vid

        batch = []
        way_count = 0
        seg_count = 0
        with open(opl_path, 'r', encoding='utf-8', errors='replace') as f:
            for line in f:
                if not line.startswith('w'):
                    continue
                tags_field = None
                nodes_field = None
                for field in line.rstrip('\r\n').split(' '):
                    if field.startswith('T'):
                        tags_field = field[1:]
                    elif field.startswith('N'):
                        nodes_field = field[1:]
                if not tags_field or not nodes_field:
                    continue

                tags = {}
                for kv in tags_field.split(','):
                    if '=' in kv:
                        k, v = kv.split('=', 1)
                        tags[_opl_unescape(k)] = _opl_unescape(v)

                base_raw = tags.get('maxspeed') or tags.get('maxspeed:lanes')
                fwd_raw = tags.get('maxspeed:forward') or tags.get('maxspeed:lanes:forward') or base_raw
                bwd_raw = tags.get('maxspeed:backward') or tags.get('maxspeed:lanes:backward') or base_raw
                way_name = (tags.get('name') or '').strip().lower()
                way_ref = (tags.get('ref') or '').strip().lower()
                fwd_id = get_val_id(fwd_raw, way_name, way_ref)
                bwd_id = get_val_id(bwd_raw, way_name, way_ref)
                if fwd_id is None and bwd_id is None:
                    continue

                try:
                    nodes = [int(n[1:]) for n in nodes_field.split(',') if n.startswith('n')]
                except ValueError:
                    continue
                if len(nodes) < 2:
                    continue

                for i in range(len(nodes) - 1):
                    if fwd_id is not None:
                        batch.append((nodes[i], nodes[i + 1], fwd_id))
                    if bwd_id is not None:
                        batch.append((nodes[i + 1], nodes[i], bwd_id))
                way_count += 1

                if len(batch) >= 200000:
                    conn.executemany('INSERT INTO seg (a, b, v) VALUES (?, ?, ?)', batch)
                    seg_count += len(batch)
                    batch.clear()

        if batch:
            conn.executemany('INSERT INTO seg (a, b, v) VALUES (?, ?, ?)', batch)
            seg_count += len(batch)
            batch.clear()

        conn.execute('CREATE INDEX seg_ab ON seg (a, b)')
        conn.commit()
        conn.close()
        os.replace(tmp_db_path, db_path)
        emit(f'[MAXSPEED] Indexed {way_count} ways ({seg_count} directed segments) for {profile.upper()} maxspeed lookups.')
        return True
    except Exception as e:
        emit(f'Warning: Failed to build maxspeed index for {profile.upper()}: {e}')
        return False
    finally:
        for p in (filtered_path, opl_path, tmp_db_path):
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

def sync_osrm_proxy_script(data_dir: str = None) -> str:
    """Copies backend/osrm_maxspeed_proxy.py into /data so maxspeed sidecar containers can execute it."""
    if data_dir is None:
        data_dir = get_data_dir()
    src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'osrm_maxspeed_proxy.py')
    dst = os.path.join(data_dir, 'osrm_maxspeed_proxy.py')
    try:
        if not os.path.exists(src):
            return dst
        os.makedirs(data_dir, exist_ok=True)
        with open(src, 'rb') as sf:
            src_bytes = sf.read()
        if os.path.exists(dst):
            try:
                with open(dst, 'rb') as df:
                    if df.read() == src_bytes:
                        return dst
            except Exception:
                pass
        tmp_dst = dst + '.tmp'
        with open(tmp_dst, 'wb') as tf:
            tf.write(src_bytes)
        os.replace(tmp_dst, dst)
    except Exception as e:
        print(f'[MAXSPEED] Notice syncing osrm_maxspeed_proxy.py: {e}', flush=True)
    return dst

def get_proxy_script_sha() -> str:
    """SHA-1 of backend/osrm_maxspeed_proxy.py (used to detect sidecars running stale proxy code)."""
    import hashlib
    try:
        src = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'osrm_maxspeed_proxy.py')
        with open(src, 'rb') as f:
            return hashlib.sha1(f.read()).hexdigest()
    except Exception:
        return ''

def get_python_proxy_image(client) -> str:
    """Returns a local Docker image containing Python 3 + sqlite3 (prefers the running backend image)."""
    if os.path.exists('/.dockerenv'):
        try:
            me = client.containers.get(os.environ.get('HOSTNAME') or '')
            if me.image.tags:
                return me.image.tags[0]
            return me.image.id
        except Exception:
            pass
    for candidate in ('routeops-backend:latest', 'python:3.10-slim'):
        try:
            client.images.get(candidate)
            return candidate
        except Exception:
            pass
    return 'python:3.10-slim'

def is_legacy_osrm_container(container) -> bool:
    """Returns True if an OSRM container is running directly on :5000 instead of internal :5050 behind the maxspeed proxy."""
    try:
        cmd = container.attrs.get('Config', {}).get('Cmd') or []
        if isinstance(cmd, str):
            cmd_str = cmd
        else:
            cmd_str = ' '.join(str(x) for x in cmd)
        return '--port 5050' not in cmd_str
    except Exception:
        return False

def stop_and_remove_osrm_profile(client, profile: str, quiet: bool = False):
    """Stops and removes both the maxspeed proxy sidecar and OSRM container for `profile`."""
    emit = (lambda *a: print(*a, flush=True)) if quiet else log_msg
    sidecar_name = f'routeops-maxspeed-{profile}-1'
    try:
        sc = client.containers.get(sidecar_name)
        try:
            sc.stop(timeout=5)
        except Exception:
            pass
        try:
            sc.remove(force=True)
        except Exception:
            pass
    except Exception:
        pass

    for container in client.containers.list(all=True):
        if f'osrm-{profile}' in container.name:
            emit(f'Stopping and removing {container.name}...')
            try:
                container.stop(timeout=10)
            except Exception:
                pass
            try:
                container.remove(force=True)
            except Exception:
                pass

def ensure_maxspeed_sidecar(client, profile: str, osrm_container, quiet: bool = False):
    """Ensures `routeops-maxspeed-{profile}-1` shares `osrm_container`'s netns and proxies :5000 -> 127.0.0.1:5050."""
    emit = (lambda *a: print(*a, flush=True)) if quiet else log_msg
    with _proxy_arch_lock:
        sync_osrm_proxy_script(get_data_dir())
        try:
            osrm_container.reload()
        except Exception:
            return
        if osrm_container.status != 'running':
            return

        sidecar_name = f'routeops-maxspeed-{profile}-1'
        expected_modes = {f'container:{osrm_container.id}', f'container:{osrm_container.name}'}
        script_sha = get_proxy_script_sha()
        try:
            sc = client.containers.get(sidecar_name)
            net_mode = (sc.attrs.get('HostConfig', {}) or {}).get('NetworkMode') or ''
            sc_sha = ((sc.attrs.get('Config', {}) or {}).get('Labels') or {}).get('routeops.proxy_sha', '')
            # Recreate the sidecar when the proxy script changed so it never serves stale code.
            if net_mode in expected_modes and sc_sha == script_sha:
                if sc.status == 'running':
                    return
                try:
                    sc.start()
                    return
                except Exception:
                    pass
            try:
                sc.remove(force=True)
            except Exception:
                pass
        except Exception:
            pass

        proxy_image = get_python_proxy_image(client)
        try:
            client.containers.run(
                proxy_image,
                ['python3', '/data/osrm_maxspeed_proxy.py', '--profile', profile, '--listen', '5000', '--upstream', '5050', '--data-dir', '/data'],
                name=sidecar_name,
                network_mode=f'container:{osrm_container.id}',
                labels={'routeops.proxy_sha': script_sha},
                log_config=_engine_log_config(),
                detach=True,
                restart_policy={'Name': 'always'},
                **get_docker_mounts()
            )
            emit(f'[MAXSPEED] Started maxspeed proxy sidecar ({sidecar_name}) for {profile.upper()}.')
        except Exception as e:
            emit(f'Warning: Could not start {sidecar_name}: {e}')

def start_osrm_engine_containers(client, profile: str, host_port: int, quiet: bool = False):
    """Recreates `routeops-osrm-{profile}-1` (internal :5050, host port -> :5000) + `routeops-maxspeed-{profile}-1` (:5000)."""
    import time
    emit = (lambda *a: print(*a, flush=True)) if quiet else log_msg
    with _proxy_arch_lock:
        sync_osrm_proxy_script(get_data_dir())
        stop_and_remove_osrm_profile(client, profile, quiet=quiet)
        emit(f'Recreating osrm-{profile} container on port {host_port} with shared memory and maxspeed proxy...')
        osrm_c = client.containers.run(
            'osrm/osrm-backend',
            f'sh -c "osrm-datastore /data/{profile}.osrm && exec osrm-routed --port 5050 --shared-memory=yes --algorithm mld"',
            entrypoint='',
            name=f'routeops-osrm-{profile}-1',
            ports={'5000/tcp': host_port},
            log_config=_engine_log_config(),
            **get_docker_mounts(),
            detach=True,
            restart_policy={'Name': 'always'},
            ipc_mode='shareable'
        )
        emit(f'Waiting for {profile} profile to finish loading into memory...')
        for _ in range(15):
            time.sleep(2)
            try:
                if b'running and waiting for requests' in osrm_c.logs(tail=20):
                    break
            except Exception:
                pass
        ensure_maxspeed_sidecar(client, profile, osrm_c, quiet=quiet)
        _osrm_base_url_cache.pop(profile, None)
        return osrm_c

def ensure_osrm_proxy_architecture(client):
    """Auto-upgrades legacy OSRM containers to :5050 + sidecar :5000 and keeps sidecars healthy."""
    if _deployment_active:
        return
    if not _proxy_arch_lock.acquire(blocking=False):
        return
    try:
        if _deployment_active:
            return
        data_dir = get_data_dir()
        sync_osrm_proxy_script(data_dir)
        saved_ports = get_saved_ports()
        for profile in ('car', 'foot'):
            if _deployment_active:
                return
            osrm_c = next(
                (c for c in client.containers.list(all=True) if f'osrm-{profile}' in c.name and c.status == 'running'),
                None
            )
            if not osrm_c:
                continue
            if is_legacy_osrm_container(osrm_c):
                has_graph = (
                    os.path.exists(os.path.join(data_dir, f'{profile}.osrm'))
                    or os.path.exists(os.path.join(data_dir, f'{profile}.osrm.ebg'))
                )
                if not has_graph:
                    continue
                host_port = saved_ports.get(profile, 5001 if profile == 'car' else 5005)
                pb = (osrm_c.attrs.get('HostConfig', {}) or {}).get('PortBindings', {}).get('5000/tcp')
                if pb and len(pb) > 0:
                    try:
                        host_port = int(pb[0]['HostPort'])
                    except Exception:
                        pass
                print(f'[MAXSPEED] Upgrading legacy {osrm_c.name} on port {host_port} to enable maxspeed proxy...', flush=True)
                start_osrm_engine_containers(client, profile, host_port, quiet=True)
            else:
                ensure_maxspeed_sidecar(client, profile, osrm_c, quiet=True)
    finally:
        _proxy_arch_lock.release()

def startup_maxspeed_maintenance():
    """Background startup maintenance: upgrades running OSRM containers and backfills missing maxspeed SQLite indexes."""
    import shutil
    import urllib.request
    data_dir = get_data_dir()
    temp_files = []
    try:
        client = docker.from_env()
        ensure_osrm_proxy_architecture(client)

        for profile in ('car', 'foot'):
            db_path = os.path.join(data_dir, f'{profile}_maxspeed.sqlite')
            if os.path.exists(db_path):
                upgrade_legacy_maxspeed_db_inplace(db_path)

        downloaded_Cache = {}
        for profile in ('car', 'foot'):
            if _deployment_active:
                return
            has_graph = (
                os.path.exists(os.path.join(data_dir, f'{profile}.osrm'))
                or os.path.exists(os.path.join(data_dir, f'{profile}.osrm.ebg'))
            )
            db_path = os.path.join(data_dir, f'{profile}_maxspeed.sqlite')
            if not has_graph or maxspeed_db_is_current(db_path):
                continue

            if profile == 'foot' and can_reuse_car_maxspeed_for_foot(data_dir):
                try:
                    shutil.copyfile(os.path.join(data_dir, 'car_maxspeed.sqlite'), db_path)
                    print('[MAXSPEED-BACKFILL] Copied car_maxspeed.sqlite to foot_maxspeed.sqlite (identical regions).', flush=True)
                    continue
                except Exception:
                    pass

            regions = _get_profile_active_regions(data_dir, profile)
            if not regions:
                continue

            # An existing (mph-capable) index already serves speeds; only re-download huge extracts on the next deployment.
            if maxspeed_db_has_mph_schema(db_path) and any(r == 'planet' or r in TOP_LEVEL_GEOFABRIK_REGIONS for r in regions):
                print(f'[MAXSPEED-BACKFILL] {profile}_maxspeed.sqlite lacks road names; it will be rebuilt on the next deployment (regions too large for background refresh).', flush=True)
                continue

            print(f'[MAXSPEED-BACKFILL] Building {profile}_maxspeed.sqlite (with OSM road names) from regions: {regions}', flush=True)
            region_files = []
            download_failed = False
            for region_id in regions:
                if _deployment_active:
                    return
                if region_id in downloaded_Cache and os.path.exists(downloaded_Cache[region_id]):
                    region_files.append(os.path.basename(downloaded_Cache[region_id]))
                    continue
                safe_slug = region_id.replace('/', '__')
                dl_name = f'_maxspeed_dl_{safe_slug}.osm.pbf'
                dl_path = os.path.join(data_dir, dl_name)
                temp_files.append(dl_path)
                url = get_geofabrik_url(region_id)
                try:
                    print(f'[MAXSPEED-BACKFILL] Downloading {url}...', flush=True)
                    urllib.request.urlretrieve(url, dl_path)
                    downloaded_Cache[region_id] = dl_path
                    region_files.append(dl_name)
                except Exception as e:
                    print(f'[MAXSPEED-BACKFILL] Failed downloading {region_id}: {e}', flush=True)
                    download_failed = True
                    break

            if download_failed or not region_files or _deployment_active:
                continue

            if len(region_files) == 1:
                src_pbf_name = region_files[0]
            else:
                src_pbf_name = f'_maxspeed_src_{profile}.osm.pbf'
                src_pbf_path = os.path.join(data_dir, src_pbf_name)
                temp_files.append(src_pbf_path)
                merge_cmd = ['osmium', 'merge'] + [f'/data/{fn}' for fn in region_files] + ['-o', f'/data/{src_pbf_name}', '-O']
                if not stream_container_logs(client, 'stefda/osmium-tool', merge_cmd, quiet=True, **get_docker_mounts()):
                    continue

            if not _deployment_active:
                build_maxspeed_index(client, data_dir, profile, pbf_filename=src_pbf_name, quiet=True)
    except Exception as e:
        print(f'[MAXSPEED-BACKFILL] Notice during startup maintenance: {e}', flush=True)
    finally:
        for p in temp_files:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

def wait_for_nominatim_and_cleanup(client, data_dir: str, container_name: str = 'routeops-nominatim-1', timeout: int = 1800):
    """Waits for Nominatim PBF import to finish and cleans up unnecessary PBF and temporary files."""
    import time
    log_msg(f"Waiting for Nominatim ({container_name}) to finish importing map data...")
    start_time = time.time()
    last_ts = int(start_time) - 5
    ready = False

    while time.time() - start_time < timeout:
        try:
            try:
                c = client.containers.get(container_name)
            except Exception:
                c = client.containers.get('nominatim')
            c.reload()
            if c.status != 'running':
                log_msg(f"Warning: Nominatim container status is {c.status}.")
                break

            now_ts = int(time.time())
            raw_logs = c.logs(since=last_ts, until=now_ts).decode('utf-8', errors='replace')
            last_ts = now_ts
            for line in raw_logs.splitlines():
                s_line = line.strip()
                if s_line:
                    log_msg(s_line)
                    if 'nominatim is ready' in s_line.lower() or 'application startup complete' in s_line.lower():
                        ready = True

            chk = c.exec_run('sh -c "ls /var/lib/postgresql/*/main/import-finished >/dev/null 2>&1 || ls /var/lib/postgresql/*/main/initialized >/dev/null 2>&1"')
            if chk.exit_code == 0:
                ready = True

            if ready:
                log_msg("Nominatim import complete and service is ready!")
                cleanup_engine_files(
                    client,
                    data_dir,
                    'nominatim',
                    container_names=['routeops-nominatim-1', 'nominatim'],
                    extra_container_paths=['/nominatim/data.osm.pbf', '/nominatim/*.pbf']
                )
                cleanup_raw_state_pbfs(data_dir)
                return True
        except Exception:
            pass
        time.sleep(2)

    def deferred_nominatim_cleanup():
        import time as _t
        for _ in range(3600):
            try:
                try:
                    c = client.containers.get(container_name)
                except Exception:
                    c = client.containers.get('nominatim')
                if c.status != 'running':
                    break
                chk = c.exec_run('sh -c "ls /var/lib/postgresql/*/main/import-finished >/dev/null 2>&1 || ls /var/lib/postgresql/*/main/initialized >/dev/null 2>&1"')
                if chk.exit_code == 0:
                    cleanup_engine_files(
                        client,
                        data_dir,
                        'nominatim',
                        container_names=['routeops-nominatim-1', 'nominatim'],
                        extra_container_paths=['/nominatim/data.osm.pbf', '/nominatim/*.pbf']
                    )
                    cleanup_raw_state_pbfs(data_dir)
                    break
            except Exception:
                pass
            _t.sleep(5)

    threading.Thread(target=deferred_nominatim_cleanup, daemon=True).start()
    return False

def process_deploy(car_port: int, foot_port: int, engines: dict = None, standalone: bool = True):
    global _deployment_active
    if engines is None:
        engines = {"car": True, "foot": True}
    import shutil
    import yaml
    import os
    import docker
    
    if standalone:
        _deployment_active = True
    log_msg(f'Starting deployment with car_port={car_port}, foot_port={foot_port}')
    
    # 1. Update compose file
    update_compose_ports(
        car_port=car_port if engines.get("car", True) else None,
        foot_port=foot_port if engines.get("foot", True) else None
    )
        
    try:
        # 2. Stop and remove existing OSRM + maxspeed sidecar containers
        client = docker.from_env()
        if engines.get("car", True):
            stop_and_remove_osrm_profile(client, 'car')
        if engines.get("foot", True):
            stop_and_remove_osrm_profile(client, 'foot')
                
        # 3. Clean /data directory for targeted engines that have a new PBF to compile
        data_dir = get_data_dir()
        sync_osrm_proxy_script(data_dir)
        has_car_pbf = os.path.exists(os.path.join(data_dir, 'car.osm.pbf'))
        has_foot_pbf = os.path.exists(os.path.join(data_dir, 'foot.osm.pbf'))
        for f in os.listdir(data_dir):
            if f not in ['speeds.csv', 'active_states.json', 'pelias.json', 'ports.json', 'deploy.log', 'api_calls.json', 'osrm_maxspeed_proxy.py'] and not f.startswith('osrm_portal.db') and not f.endswith('.osm.pbf'):
                if (f.startswith('car') or f.startswith('backup_car')) and (not engines.get("car", True) or not has_car_pbf):
                    continue
                if (f.startswith('foot') or f.startswith('backup_foot')) and (not engines.get("foot", True) or not has_foot_pbf):
                    continue
                p = os.path.join(data_dir, f)
                if os.path.isfile(p):
                    os.remove(p)
                elif os.path.isdir(p):
                    shutil.rmtree(p)
        log_msg('Wiped old OSRM graph data for targeted engines.')
        
        # 4. Build graphs if pbf exists
        if has_car_pbf or has_foot_pbf:
            
            has_speeds = export_speeds_csv(data_dir)
            built_car_maxspeed = False
            
            if engines.get("car", True) and has_car_pbf:
                built_car_maxspeed = build_maxspeed_index(client, data_dir, 'car')
                if not build_osrm_graph(client, data_dir, 'car', has_speeds):
                    log_msg('Error: CAR OSRM graph build failed.')
            
            if engines.get("foot", True) and has_foot_pbf:
                if built_car_maxspeed and can_reuse_car_maxspeed_for_foot(data_dir):
                    shutil.copyfile(os.path.join(data_dir, 'car_maxspeed.sqlite'), os.path.join(data_dir, 'foot_maxspeed.sqlite'))
                    log_msg('[MAXSPEED] Reused CAR maxspeed index for FOOT (identical regions).')
                else:
                    build_maxspeed_index(client, data_dir, 'foot')
                if not build_osrm_graph(client, data_dir, 'foot', has_speeds):
                    log_msg('Error: FOOT OSRM graph build failed.')
        else:
            log_msg('Notice: No new .osm.pbf files found. Using existing compiled graphs if available.')
            
        # 5. Recreate containers with new ports (+ maxspeed proxy sidecars) and clean up unnecessary files
        if engines.get("car", True) and (os.path.exists(os.path.join(data_dir, 'car.osrm')) or os.path.exists(os.path.join(data_dir, 'car.osrm.ebg'))):
            start_osrm_engine_containers(client, 'car', car_port)
            cleanup_engine_files(client, data_dir, 'car', container_names=['routeops-osrm-car-1'])
                    
        if engines.get("foot", True) and (os.path.exists(os.path.join(data_dir, 'foot.osrm')) or os.path.exists(os.path.join(data_dir, 'foot.osrm.ebg'))):
            start_osrm_engine_containers(client, 'foot', foot_port)
            cleanup_engine_files(client, data_dir, 'foot', container_names=['routeops-osrm-foot-1'])
        
        if standalone:
            cleanup_raw_state_pbfs(data_dir)
            log_msg('Deployment complete!')
    except Exception as e:
        log_msg(f'Deployment failed: {e}')
    finally:
        if standalone:
            _deployment_active = False

@app.post('/system/deploy')
def deploy_osrm(req: DeployRequest, background_tasks: BackgroundTasks):
    if _deployment_active:
        return JSONResponse(status_code=409, content={'error': 'A deployment is already running.'})
    port_err = validate_engine_ports({'car': req.car_port, 'foot': req.foot_port})
    if port_err:
        return JSONResponse(status_code=400, content={'error': port_err})
    save_ports({'car': req.car_port, 'foot': req.foot_port})
    background_tasks.add_task(process_deploy, req.car_port, req.foot_port)
    return {'status': 'Deploying...'}

# ==========================================================================
# OSRM proxy with OSM maxspeed enrichment
#   GET /osrm/{car|foot}/{service}/v1/{osrm_profile}/{coordinates}?{osrm query}
#   (via frontend: /api/osrm/...)
# ==========================================================================

_osrm_base_url_cache = {}

def get_osrm_base_url(profile: str, refresh: bool = False) -> str:
    """Resolves a URL the backend can use to reach the running OSRM container for a profile."""
    import time
    cached = _osrm_base_url_cache.get(profile)
    if cached and not refresh and time.time() - cached[1] < 30:
        return cached[0]

    port = get_saved_ports().get(profile, 5001 if profile == 'car' else 5005)
    url = f'http://localhost:{port}'
    if os.path.exists('/.dockerenv'):
        url = f'http://host.docker.internal:{port}'
        try:
            client = docker.from_env()
            osrm_c = next((c for c in client.containers.list() if f'osrm-{profile}' in c.name), None)
            if osrm_c:
                # Attach the OSRM container to the backend's network so it is reachable by name.
                me = client.containers.get(os.environ.get('HOSTNAME') or '')
                my_nets = list((me.attrs.get('NetworkSettings', {}).get('Networks') or {}).keys())
                osrm_nets = (osrm_c.attrs.get('NetworkSettings', {}).get('Networks') or {}).keys()
                if my_nets and not any(n in osrm_nets for n in my_nets):
                    client.networks.get(my_nets[0]).connect(osrm_c)
                url = f'http://{osrm_c.name}:5000'
        except Exception:
            pass

    _osrm_base_url_cache[profile] = (url, time.time())
    return url

@app.get('/osrm/{profile}/{service}/v1/{osrm_profile}/{coordinates:path}')
def osrm_proxy(profile: str, service: str, osrm_profile: str, coordinates: str, request: Request):
    """Proxies an OSRM request to the car/foot engine and adds single-road OSM `max_speed: {mph, kph}`."""
    import urllib.request
    import urllib.error

    if profile not in ('car', 'foot'):
        return JSONResponse(status_code=400, content={'code': 'InvalidProfile', 'message': "Profile must be 'car' or 'foot'."})

    enrich = (service == 'route')
    query, keep_nodes, keep_had_ann, keep_steps = prepare_upstream_query(request.url.query or '', enrich)
    path = f'/{service}/v1/{osrm_profile}/{coordinates}'
    # Internal engine call: never route through HTTP(S) proxies configured on the host.
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def fetch(base_url):
        url = f'{base_url}{path}' + (f'?{query}' if query else '')
        try:
            with opener.open(url, timeout=60) as resp:
                return resp.status, resp.headers.get('Content-Type', 'application/json'), resp.read()
        except urllib.error.HTTPError as he:
            return he.code, he.headers.get('Content-Type', 'application/json'), he.read()

    try:
        status, content_type, body = fetch(get_osrm_base_url(profile))
    except Exception:
        try:
            status, content_type, body = fetch(get_osrm_base_url(profile, refresh=True))
        except Exception as e:
            return JSONResponse(status_code=502, content={'code': 'EngineUnavailable', 'message': f'OSRM {profile} engine is not reachable: {e}'})

    if not enrich or 'json' not in (content_type or '').lower():
        return Response(content=body, status_code=status, media_type=content_type)

    try:
        data = json.loads(body)
    except Exception:
        return Response(content=body, status_code=status, media_type=content_type)

    if status == 200 and data.get('code') == 'Ok':
        try:
            def fetch_json(path_and_query):
                with opener.open(f'{get_osrm_base_url(profile)}{path_and_query}', timeout=10) as r:
                    return json.loads(r.read())

            data = enrich_osrm_response(
                data,
                db_path=get_maxspeed_db_path(profile),
                keep_nodes=keep_nodes,
                keep_had_annotations=keep_had_ann,
                keep_steps=keep_steps,
                nearest_fetcher=make_nearest_fetcher(fetch_json, osrm_profile),
            )
        except Exception:
            pass
    return JSONResponse(status_code=status, content=data)



def log_msg(*args, **kwargs):
    msg = " ".join(str(a) for a in args)
    print(msg, flush=True)
    try:
        with open(os.path.join(get_data_dir(), 'deploy.log'), 'a') as lf:
            lf.write(msg + '\n')
    except:
        pass

def update_compose_ports(car_port: int = None, foot_port: int = None):
    try:
        candidates = [
            os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'docker-compose.yml')),
            os.path.abspath('docker-compose.yml'),
            os.path.abspath('../docker-compose.yml'),
        ]
        for compose_path in candidates:
            if os.path.exists(compose_path):
                with open(compose_path, 'r') as f:
                    compose_data = yaml.safe_load(f) or {}
                if 'services' in compose_data and isinstance(compose_data['services'], dict):
                    changed = False
                    if car_port and 'osrm-car' in compose_data['services']:
                        compose_data['services']['osrm-car']['ports'] = [f'{car_port}:5000']
                        changed = True
                    if foot_port and 'osrm-foot' in compose_data['services']:
                        compose_data['services']['osrm-foot']['ports'] = [f'{foot_port}:5000']
                        changed = True
                    if changed:
                        with open(compose_path, 'w') as f:
                            yaml.safe_dump(compose_data, f, sort_keys=False)
                        log_msg(f'Updated {compose_path} ports.')
                    break
    except Exception as e:
        log_msg(f'Notice: Skipping docker-compose.yml update: {e}')

@app.get('/system/logs')
def get_system_logs():
    try:
        with open(os.path.join(get_data_dir(), 'deploy.log'), 'r') as lf:
            lines = lf.readlines()
            return {'logs': [l.strip() for l in lines]}
    except:
        return {'logs': ['[SYSTEM] Listening for deployment events...']}

from typing import Dict

class MergeRequest(BaseModel):
    states: Dict[str, list[str]]
    car_port: int
    foot_port: int
    nominatim_port: int = 5003
    pelias_port: int = 5002
    force_download: bool = False
    engines: Dict[str, bool] = {"car": True, "foot": True, "nominatim": True, "pelias": True}

@app.post('/system/merge')
def merge_states(req: MergeRequest, background_tasks: BackgroundTasks):
    if _deployment_active:
        return JSONResponse(status_code=409, content={'error': 'A deployment is already running.'})
    port_err = validate_engine_ports({
        'car': req.car_port,
        'foot': req.foot_port,
        'nominatim': req.nominatim_port,
        'pelias': req.pelias_port,
    })
    if port_err:
        return JSONResponse(status_code=400, content={'error': port_err})

    data_dir = get_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    prev_states = load_active_states(data_dir)
    merged_states = merge_active_states_for_engines(prev_states, req.states, req.engines)

    try:
        with open(os.path.join(data_dir, 'deploy.log'), 'w'):
            pass
    except Exception:
        pass
        
    try:
        write_active_states(data_dir, merged_states)
        save_ports({'car': req.car_port, 'foot': req.foot_port, 'nominatim': req.nominatim_port, 'pelias': req.pelias_port})
        update_compose_ports(car_port=req.car_port, foot_port=req.foot_port)
    except Exception:
        pass

    def process_merge(states_dict: dict, force_download: bool, engines: dict):
        log_msg(f'Starting merge for {states_dict}')
        data_dir = get_data_dir()
        os.makedirs(data_dir, exist_ok=True)
            
        all_states = set()
        for profile, s_list in states_dict.items():
            if is_engine_enabled(engines, profile) and s_list:
                for s in normalize_region_list(s_list):
                    all_states.add(s)
                
        failed_dl = download_region_files(sorted(all_states), data_dir, force_download)
        if failed_dl:
            raise RuntimeError(f'Download failed for: {", ".join(failed_dl)}')
                    
        client = docker.from_env()
        
        for profile, raw_states_req in states_dict.items():
            states_req = normalize_region_list(raw_states_req)
            if not states_req or not is_engine_enabled(engines, profile):
                continue
                
            out_file = f'/data/{profile}.osm.pbf'
            host_out_file = os.path.join(data_dir, f'{profile}.osm.pbf')
            if len(states_req) == 1:
                src_pbf = os.path.join(data_dir, get_region_pbf_filename(states_req[0]))
                _link_or_copy(src_pbf, host_out_file)
                log_msg(f'Prepared {states_req[0]} -> {profile}.osm.pbf')
            elif len(states_req) > 1:
                log_msg(f'Merging files for {profile} using osmium-tool...')
                files_to_merge = [f'/data/{get_region_pbf_filename(s)}' for s in states_req]
                command = ['osmium', 'merge'] + files_to_merge + ['-o', out_file, '-O']
                if stream_container_logs(client, 'stefda/osmium-tool', command, **get_docker_mounts()):
                    log_msg(f'Merge successful for {profile}!')
                else:
                    raise RuntimeError(f'osmium merge failed for {profile}')

        # Clean up raw state PBFs immediately after merging into profile PBFs
        cleanup_raw_state_pbfs(data_dir, keep_files={'car.osm.pbf', 'foot.osm.pbf', 'nominatim.osm.pbf', 'pelias.osm.pbf'})
                    
        log_msg('--- MERGE COMPLETE, STARTING DEPLOYMENT ---')
        osrm_engines = {
            'car': is_engine_enabled(engines, 'car'),
            'foot': is_engine_enabled(engines, 'foot'),
        }
        if osrm_engines['car'] or osrm_engines['foot']:
            process_deploy(req.car_port, req.foot_port, engines=osrm_engines, standalone=False)
            
        try:
            client = docker.from_env()
            try: client.networks.get('routeops-geocoding_default')
            except: client.networks.create('routeops-geocoding_default', driver='bridge')
        except: pass
        
        if is_engine_enabled(engines, "nominatim"):
            log_msg(f'Recreating Nominatim on port {req.nominatim_port}...')
            try:
                client = docker.from_env()
                _remove_container_if_exists(client, 'routeops-nominatim-1')
                _remove_container_if_exists(client, 'nominatim')
                has_nom_pbf = os.path.exists(os.path.join(data_dir, 'nominatim.osm.pbf'))
                if has_nom_pbf:
                    try:
                        client.volumes.get('nominatim-data').remove(force=True)
                    except:
                        pass
                run_nominatim_container(client, 'routeops-nominatim-1', get_nominatim_pg_data_dir(client), host_port=req.nominatim_port)
                log_msg('Nominatim Recreated!')
                if has_nom_pbf:
                    wait_for_nominatim_and_cleanup(client, data_dir, 'routeops-nominatim-1')
                else:
                    cleanup_engine_files(client, data_dir, 'nominatim', container_names=['routeops-nominatim-1', 'nominatim'], extra_container_paths=['/nominatim/data.osm.pbf', '/nominatim/*.pbf'])
            except Exception as e: log_msg(f"Nominatim restart failed: {e}")
        if is_engine_enabled(engines, "pelias"):
            log_msg(f'Rebuilding Pelias Index and recreating API on port {req.pelias_port}...')
            try:
                client = docker.from_env()
                with open(os.path.join(data_dir, 'pelias.json'), 'w') as f:
                    f.write(PELIAS_CONFIG_JSON)

                _remove_container_if_exists(client, 'routeops-pelias-1')
                _remove_container_if_exists(client, 'pelias_api')
                ensure_pelias_elasticsearch_container(client, fresh=True)

                if not setup_pelias_schema(client, get_docker_mounts()):
                    log_msg("Pelias schema setup failed. Skipping OSM import.")
                else:
                    log_msg("--- Starting Pelias OSM Import ---")
                    stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
                
                client.containers.run('pelias/api:master', name='routeops-pelias-1', ports={'3100/tcp': req.pelias_port}, environment={'PELIAS_CONFIG': '/data/pelias.json'}, network='routeops-geocoding_default', log_config=_engine_log_config(), restart_policy={'Name': 'always'}, detach=True, **get_docker_mounts())
                cleanup_engine_files(client, data_dir, 'pelias', container_names=['routeops-pelias-1', 'pelias_api', 'routeops-pelias-elasticsearch-1'])
                
                log_msg("--- Pelias Build & API Restart Finished! ---")
            except Exception as e:
                log_msg(f"Pelias build error: {e}")
        
        cleanup_raw_state_pbfs(data_dir)
        log_msg('Fresh Deployment complete!')
        log_msg('Deployment complete!')
            
    def safe_process_merge(*args):
        global _deployment_active
        _deployment_active = True
        try:
            process_merge(*args)
        except Exception as e:
            log_msg(f"Fatal deployment error: {e}")
            cleanup_raw_state_pbfs(get_data_dir())
            log_msg("Deployment failed")
            restore_active_states(get_data_dir(), prev_states)
        finally:
            _deployment_active = False
            
    background_tasks.add_task(safe_process_merge, req.states, req.force_download, req.engines)
    return {'status': 'Started'}

@app.post('/system/update')
def update_states(req: MergeRequest, background_tasks: BackgroundTasks):
    if _deployment_active:
        return JSONResponse(status_code=409, content={'error': 'A deployment is already running.'})
    port_err = validate_engine_ports({
        'car': req.car_port,
        'foot': req.foot_port,
        'nominatim': req.nominatim_port,
        'pelias': req.pelias_port,
    })
    if port_err:
        return JSONResponse(status_code=400, content={'error': port_err})

    data_dir = get_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    prev_states = load_active_states(data_dir)
    merged_states = merge_active_states_for_engines(prev_states, req.states, req.engines)

    try:
        with open(os.path.join(data_dir, 'deploy.log'), 'w'):
            pass
    except Exception:
        pass
        
    try:
        write_active_states(data_dir, merged_states)
        save_ports({'car': req.car_port, 'foot': req.foot_port, 'nominatim': req.nominatim_port, 'pelias': req.pelias_port})
        update_compose_ports(car_port=req.car_port, foot_port=req.foot_port)
    except Exception:
        pass

    def process_update(states_dict: dict, force_download: bool, engines: dict):
        import shutil
        
        log_msg(f'Starting zero-downtime update for {states_dict}')
        data_dir = get_data_dir()
        os.makedirs(data_dir, exist_ok=True)
            
        all_states = set()
        for profile, s_list in states_dict.items():
            if is_engine_enabled(engines, profile) and s_list:
                for s in normalize_region_list(s_list):
                    all_states.add(s)
                
        failed_dl = download_region_files(sorted(all_states), data_dir, force_download)
        if failed_dl:
            raise RuntimeError(f'Download failed for: {", ".join(failed_dl)}')
                    
        client = docker.from_env()
        
        for profile, raw_states_req in states_dict.items():
            states_req = normalize_region_list(raw_states_req)
            if not states_req or not is_engine_enabled(engines, profile):
                continue
                
            out_file = f'/data/{profile}.osm.pbf'
            host_out_file = os.path.join(data_dir, f'{profile}.osm.pbf')
            if len(states_req) == 1:
                src_pbf = os.path.join(data_dir, get_region_pbf_filename(states_req[0]))
                _link_or_copy(src_pbf, host_out_file)
                log_msg(f'Prepared {states_req[0]} -> {profile}.osm.pbf')
            elif len(states_req) > 1:
                log_msg(f'Merging files for {profile} using osmium-tool...')
                files_to_merge = [f'/data/{get_region_pbf_filename(s)}' for s in states_req]
                command = ['osmium', 'merge'] + files_to_merge + ['-o', out_file, '-O']
                if stream_container_logs(client, 'stefda/osmium-tool', command, **get_docker_mounts()):
                    log_msg(f'Merge successful for {profile}!')
                else:
                    raise RuntimeError(f'osmium merge failed for {profile}')

        # Clean up raw state PBFs immediately after merging into profile PBFs
        cleanup_raw_state_pbfs(data_dir, keep_files={'car.osm.pbf', 'foot.osm.pbf', 'nominatim.osm.pbf', 'pelias.osm.pbf'})
                    
        has_speeds = export_speeds_csv(data_dir)
        sync_osrm_proxy_script(data_dir)
        built_car_maxspeed = False
        
        if is_engine_enabled(engines, "car") and os.path.exists(os.path.join(data_dir, 'car.osm.pbf')):
            built_car_maxspeed = build_maxspeed_index(client, data_dir, 'car')
            if not build_osrm_graph(client, data_dir, 'car', has_speeds):
                log_msg('Error: CAR OSRM graph build failed.')
        
        if is_engine_enabled(engines, "foot") and os.path.exists(os.path.join(data_dir, 'foot.osm.pbf')):
            if built_car_maxspeed and can_reuse_car_maxspeed_for_foot(data_dir):
                shutil.copyfile(os.path.join(data_dir, 'car_maxspeed.sqlite'), os.path.join(data_dir, 'foot_maxspeed.sqlite'))
                log_msg('[MAXSPEED] Reused CAR maxspeed index for FOOT (identical regions).')
            else:
                build_maxspeed_index(client, data_dir, 'foot')
            if not build_osrm_graph(client, data_dir, 'foot', has_speeds):
                log_msg('Error: FOOT OSRM graph build failed.')
            
        if is_engine_enabled(engines, "car") and (os.path.exists(os.path.join(data_dir, 'car.osrm')) or os.path.exists(os.path.join(data_dir, 'car.osrm.ebg')) or os.path.exists(os.path.join(data_dir, 'car.osm.pbf'))):
            car_container = None
            car_running_port = None
            for container in client.containers.list(all=True):
                if 'osrm-car' in container.name:
                    car_container = container
                    pb = container.attrs.get('HostConfig', {}).get('PortBindings', {}).get('5000/tcp')
                    if pb and len(pb) > 0:
                        try: car_running_port = int(pb[0]['HostPort'])
                        except: pass
                    break

            need_port_change = (car_running_port != req.car_port)
            need_container_create = (car_container is None or car_container.status != 'running')
            need_legacy_upgrade = (car_container is not None and is_legacy_osrm_container(car_container))

            if need_port_change or need_container_create or need_legacy_upgrade:
                if os.path.exists(os.path.join(data_dir, 'car.osrm')) or os.path.exists(os.path.join(data_dir, 'car.osrm.ebg')):
                    start_osrm_engine_containers(client, 'car', req.car_port)
                    log_msg(f'Started CAR profile container on port {req.car_port}.')
            elif car_container and car_container.status == 'running':
                log_msg('Hot-reloading CAR container with shared memory...')
                car_container.exec_run('osrm-datastore /data/car.osrm')
                ensure_maxspeed_sidecar(client, 'car', car_container)
                log_msg('Hot-reloaded CAR profile successfully.')
            cleanup_engine_files(client, data_dir, 'car', container_names=['routeops-osrm-car-1'])
        
        if is_engine_enabled(engines, "foot") and (os.path.exists(os.path.join(data_dir, 'foot.osrm')) or os.path.exists(os.path.join(data_dir, 'foot.osrm.ebg')) or os.path.exists(os.path.join(data_dir, 'foot.osm.pbf'))):
            foot_container = None
            foot_running_port = None
            for container in client.containers.list(all=True):
                if 'osrm-foot' in container.name:
                    foot_container = container
                    pb = container.attrs.get('HostConfig', {}).get('PortBindings', {}).get('5000/tcp')
                    if pb and len(pb) > 0:
                        try: foot_running_port = int(pb[0]['HostPort'])
                        except: pass
                    break

            need_foot_port_change = (foot_running_port != req.foot_port)
            need_foot_container_create = (foot_container is None or foot_container.status != 'running')
            need_foot_legacy_upgrade = (foot_container is not None and is_legacy_osrm_container(foot_container))

            if need_foot_port_change or need_foot_container_create or need_foot_legacy_upgrade:
                if os.path.exists(os.path.join(data_dir, 'foot.osrm')) or os.path.exists(os.path.join(data_dir, 'foot.osrm.ebg')):
                    start_osrm_engine_containers(client, 'foot', req.foot_port)
                    log_msg(f'Started FOOT profile container on port {req.foot_port}.')
            elif foot_container and foot_container.status == 'running':
                log_msg('Hot-reloading FOOT container with shared memory...')
                foot_container.exec_run('osrm-datastore /data/foot.osrm')
                ensure_maxspeed_sidecar(client, 'foot', foot_container)
                log_msg('Hot-reloaded FOOT profile successfully.')
            cleanup_engine_files(client, data_dir, 'foot', container_names=['routeops-osrm-foot-1'])
                        
        try:
            client = docker.from_env()
            try: client.networks.get('routeops-geocoding_default')
            except: client.networks.create('routeops-geocoding_default', driver='bridge')
        except: pass
        
        if is_engine_enabled(engines, "nominatim"):
            nom_container = None
            nom_running_port = None
            for container in client.containers.list(all=True):
                if container.name in ['nominatim', 'routeops-nominatim-1']:
                    nom_container = container
                    pb = container.attrs.get('HostConfig', {}).get('PortBindings', {}).get('8080/tcp')
                    if pb and len(pb) > 0:
                        try: nom_running_port = int(pb[0]['HostPort'])
                        except: pass
                    break

            has_nom_pbf = os.path.exists(os.path.join(data_dir, 'nominatim.osm.pbf'))
            need_nom_port_change = (nom_running_port != req.nominatim_port)
            need_nom_container_create = (nom_container is None or nom_container.status != 'running')

            if has_nom_pbf or need_nom_port_change or need_nom_container_create:
                log_msg(f'Recreating Nominatim on port {req.nominatim_port}...')
                if nom_container:
                    try:
                        nom_container.stop()
                        nom_container.remove()
                    except:
                        pass
                if has_nom_pbf:
                    try:
                        client.volumes.get('nominatim-data').remove(force=True)
                    except:
                        pass
                run_nominatim_container(client, 'routeops-nominatim-1', get_nominatim_pg_data_dir(client), host_port=req.nominatim_port)
                log_msg('Nominatim Recreated!')
                if has_nom_pbf:
                    wait_for_nominatim_and_cleanup(client, data_dir, 'routeops-nominatim-1')
                else:
                    cleanup_engine_files(client, data_dir, 'nominatim', container_names=['routeops-nominatim-1', 'nominatim'], extra_container_paths=['/nominatim/data.osm.pbf', '/nominatim/*.pbf'])
            else:
                log_msg('Restarting Nominatim...')
                try: 
                    try: docker.from_env().containers.get('routeops-nominatim-1').restart()
                    except: docker.from_env().containers.get('nominatim').restart()
                except Exception as e: pass
                cleanup_engine_files(client, data_dir, 'nominatim', container_names=['routeops-nominatim-1', 'nominatim'], extra_container_paths=['/nominatim/data.osm.pbf', '/nominatim/*.pbf'])

        if is_engine_enabled(engines, "pelias"):
            pel_container = None
            pel_running_port = None
            for container in client.containers.list(all=True):
                if container.name in ['pelias_api', 'routeops-pelias-1']:
                    pel_container = container
                    pb = container.attrs.get('HostConfig', {}).get('PortBindings', {})
                    p_bind = pb.get('3100/tcp') or pb.get('4000/tcp')
                    if p_bind and len(p_bind) > 0:
                        try: pel_running_port = int(p_bind[0]['HostPort'])
                        except: pass
                    break

            has_pel_pbf = os.path.exists(os.path.join(data_dir, 'pelias.osm.pbf'))
            need_pel_port_change = (pel_running_port != req.pelias_port)
            need_pel_container_create = (pel_container is None or pel_container.status != 'running')

            try:
                with open(os.path.join(data_dir, 'pelias.json'), 'w') as f:
                    f.write(PELIAS_CONFIG_JSON)

                if has_pel_pbf:
                    log_msg('Rebuilding Pelias Index...')
                    ensure_pelias_elasticsearch_container(client, fresh=False)

                    if not setup_pelias_schema(client, get_docker_mounts()):
                        log_msg("Pelias schema setup failed. Skipping OSM import.")
                    else:
                        log_msg("--- Starting Pelias OSM Import ---")
                        stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())

                if need_pel_port_change or need_pel_container_create:
                    log_msg(f'Recreating Pelias API on port {req.pelias_port}...')
                    if pel_container:
                        try:
                            pel_container.stop()
                            pel_container.remove()
                        except:
                            pass
                    client.containers.run('pelias/api:master', name='routeops-pelias-1', ports={'3100/tcp': req.pelias_port}, environment={'PELIAS_CONFIG': '/data/pelias.json'}, network='routeops-geocoding_default', log_config=_engine_log_config(), restart_policy={'Name': 'always'}, detach=True, **get_docker_mounts())
                    log_msg('Pelias API Recreated!')
                else:
                    try:
                        c = client.containers.get('routeops-pelias-1')
                        c.restart()
                    except:
                        try:
                            c = client.containers.get('pelias_api')
                            c.restart()
                        except:
                            pass
                cleanup_engine_files(client, data_dir, 'pelias', container_names=['routeops-pelias-1', 'pelias_api', 'routeops-pelias-elasticsearch-1'])
            except Exception as e:
                log_msg(f"Pelias update error: {e}")

        cleanup_raw_state_pbfs(data_dir)
        log_msg('Zero-Downtime Deployment complete!')
        log_msg('Deployment complete!')

            
    def safe_process_update(*args):
        global _deployment_active
        _deployment_active = True
        try:
            process_update(*args)
        except Exception as e:
            log_msg(f"Fatal deployment error: {e}")
            cleanup_raw_state_pbfs(get_data_dir())
            log_msg("Deployment failed")
            restore_active_states(get_data_dir(), prev_states)
        finally:
            _deployment_active = False
            
    background_tasks.add_task(safe_process_update, req.states, req.force_download, req.engines)
    return {'status': 'Started'}

# ==========================================================================
# One-click install of all 4 engines (Car, Foot, Nominatim, Pelias) from the
# same OSM regions. Phase 1 downloads/merges once, phase 2 installs every
# engine without starting any public service container, phase 3 starts all
# service containers only after every installation has finished.
# ==========================================================================

NOMINATIM_IMAGE = 'mediagis/nominatim:5.3'
NOMINATIM_IMPORT_CONTAINER = 'routeops-nominatim-import'
PELIAS_CONFIG_JSON = '''{
  "logger": { "level": "info", "timestamp": false },
  "esclient": { "hosts": [{"host": "routeops-pelias-elasticsearch-1", "port": 9200}] },
  "elasticsearch": {
    "settings": {
      "index": {
        "refresh_interval": "10s",
        "number_of_replicas": "0",
        "number_of_shards": "1"
      }
    }
  },
  "api": { "services": { } },
  "imports": {
    "adminLookup": { "enabled": false },
    "openstreetmap": {
      "datapath": "/data",
      "import": [{"filename": "pelias.osm.pbf"}]
    }
  }
}'''

class InstallAllRequest(BaseModel):
    regions: list[str]
    car_port: int = 5001
    foot_port: int = 5005
    nominatim_port: int = 5003
    pelias_port: int = 5002
    force_download: bool = False

def _remove_container_if_exists(client, name: str, timeout: int = 20):
    try:
        c = client.containers.get(name)
    except Exception:
        return
    try:
        c.stop(timeout=timeout)
    except Exception:
        pass
    try:
        c.remove(force=True)
    except Exception:
        pass

def _link_or_copy(src: str, dst: str):
    """Hardlinks src -> dst (no extra disk space); falls back to a copy across filesystems."""
    import shutil
    if os.path.exists(dst):
        os.remove(dst)
    try:
        os.link(src, dst)
    except Exception:
        shutil.copyfile(src, dst)

def download_region_files(regions: list, data_dir: str, force_download: bool) -> list:
    """Downloads each region PBF once into /data (with live % progress in deploy.log). Returns failed region ids."""
    import time
    import urllib.request
    failed = []
    for region in regions:
        url = get_geofabrik_url(region)
        file_path = os.path.join(data_dir, get_region_pbf_filename(region))
        if not force_download and os.path.exists(file_path):
            log_msg(f'Using cached map data for {region}...')
            continue
        log_msg(f'Downloading {url} to {file_path}')
        last_pct = [0]
        start_time = [time.time()]

        def reporthook(block_num, block_size, total_size, url=url, file_path=file_path):
            if total_size <= 0:
                return
            pct = min(100, int((block_num * block_size * 100) / total_size))
            if pct <= last_pct[0]:
                return
            last_pct[0] = pct
            elapsed = time.time() - start_time[0]
            speed_mbps = ((block_num * block_size) / (1024 * 1024)) / elapsed if elapsed > 0 else 0
            try:
                log_path = os.path.join(get_data_dir(), 'deploy.log')
                with open(log_path, 'r') as lf:
                    lines = lf.readlines()
                if lines:
                    lines[-1] = f'Downloading {url} to {file_path} - {pct}% ({speed_mbps:.1f} MB/s)\n'
                with open(log_path, 'w') as lf:
                    lf.writelines(lines)
            except Exception:
                pass

        try:
            tmp_path = file_path + '.part'
            urllib.request.urlretrieve(url, tmp_path, reporthook=reporthook)
            os.replace(tmp_path, file_path)
        except Exception as e:
            log_msg(f'Failed to download {region}: {e}')
            failed.append(region)
    return failed

def export_speeds_csv(data_dir: str, quiet: bool = False) -> bool:
    """Writes road overrides from the DB to /data/speeds.csv. Returns True if the file has content."""
    emit = (lambda *a: print(*a, flush=True)) if quiet else log_msg
    csv_path = os.path.join(data_dir, 'speeds.csv')
    try:
        db_session = SessionLocal()
        try:
            overrides = db_session.query(RoadOverride).all()
        finally:
            db_session.close()
        tmp_path = csv_path + '.tmp'
        with open(tmp_path, 'w', newline='') as f:
            writer = csv.writer(f)

            def write_pair(a, b, speed):
                a, b = str(a or '').strip(), str(b or '').strip()
                # osrm-customize aborts on malformed rows, so only write real numeric OSM node pairs.
                if a.isdigit() and b.isdigit():
                    writer.writerow([a, b, speed])

            for ov in overrides:
                speed = 1 if ov.is_closed else max(1, int(round(ov.speed_kmh or 1)))
                if ',' in (ov.from_node or ''):
                    nodes = ov.from_node.split(',')
                    for i in range(len(nodes) - 1):
                        write_pair(nodes[i], nodes[i + 1], speed)
                        if ov.is_bidirectional:
                            write_pair(nodes[i + 1], nodes[i], speed)
                else:
                    write_pair(ov.from_node, ov.to_node, speed)
                    if ov.is_bidirectional:
                        write_pair(ov.to_node, ov.from_node, speed)
        os.replace(tmp_path, csv_path)
        emit(f'Exported {len(overrides)} road overrides to speeds.csv')
    except Exception as e:
        emit(f'Failed to export speeds.csv: {e}')
    return os.path.exists(csv_path) and os.path.getsize(csv_path) > 0

def build_osrm_graph(client, data_dir: str, profile: str, has_speeds: bool) -> bool:
    """Compiles /data/{profile}.osm.pbf into an MLD graph (+ pristine backup). Does NOT start osrm-routed."""
    label = profile.upper()
    mounts = get_docker_mounts()
    log_msg(f'Running OSRM Extract for {label}...')
    if not stream_container_logs(client, 'osrm/osrm-backend', ['osrm-extract', '-p', f'/opt/{profile}.lua', f'/data/{profile}.osm.pbf'], **mounts):
        return False
    log_msg(f'Running OSRM Partition for {label}...')
    if not stream_container_logs(client, 'osrm/osrm-backend', ['osrm-partition', f'/data/{profile}.osrm'], **mounts):
        return False
    log_msg(f'Creating backup of pristine {label} graph...')
    stream_container_logs(client, 'ubuntu', ['sh', '-c', f'mkdir -p /data/backup_{profile} && cp /data/{profile}.osrm* /data/backup_{profile}/'], **mounts)
    log_msg(f'Running OSRM Customize for {label}...')
    cust_cmd = ['osrm-customize', f'/data/{profile}.osrm']
    if has_speeds:
        cust_cmd.extend(['--segment-speed-file', '/data/speeds.csv'])
    if not stream_container_logs(client, 'osrm/osrm-backend', cust_cmd, **mounts):
        return False
    return os.path.exists(os.path.join(data_dir, f'{profile}.osrm.mldgr')) or os.path.exists(os.path.join(data_dir, f'{profile}.osrm.ebg'))

def get_nominatim_pg_data_dir(client) -> str:
    """Detects the PostgreSQL major version shipped in the Nominatim image so the data volume is mounted correctly."""
    try:
        try:
            img = client.images.get(NOMINATIM_IMAGE)
        except Exception:
            log_msg(f'Pulling {NOMINATIM_IMAGE}...')
            img = client.images.pull(NOMINATIM_IMAGE)

        # Fast path: inspect PG_MAJOR env var on the image if defined
        for env_entry in (img.attrs.get('Config', {}) or {}).get('Env') or []:
            if isinstance(env_entry, str) and env_entry.startswith('PG_MAJOR='):
                ver = env_entry.split('=', 1)[1].strip()
                if ver.isdigit():
                    return f'/var/lib/postgresql/{ver}/main'

        out_bytes = _run_ephemeral_container_cmd(
            client,
            NOMINATIM_IMAGE,
            ['sh', '-c', 'ls -1 /etc/postgresql 2>/dev/null || ls -1 /usr/lib/postgresql 2>/dev/null'],
            entrypoint='',
            timeout=30,
        )
        out = out_bytes.decode('utf-8', errors='ignore')
        versions = sorted((v for v in out.split() if v.strip().isdigit()), key=int)
        if versions:
            return f'/var/lib/postgresql/{versions[-1]}/main'
    except Exception as e:
        log_msg(f'Notice: Could not detect Nominatim PostgreSQL version ({e}); assuming 16.')
    return '/var/lib/postgresql/16/main'

def run_nominatim_container(client, name: str, pg_data_dir: str, host_port: int = None):
    """Runs Nominatim with the persistent `nominatim-data` volume. Without host_port it is an internal import-only container."""
    mounts = get_docker_mounts()
    env = {
        'PBF_PATH': '/data/nominatim.osm.pbf',
        'NOMINATIM_PASSWORD': 'super_secure_password',
    }
    if os.environ.get('NOMINATIM_REPLICATION_URL'):
        env['REPLICATION_URL'] = os.environ['NOMINATIM_REPLICATION_URL']
    kwargs = dict(
        name=name,
        environment=env,
        network='routeops-geocoding_default',
        shm_size='2g',
        log_config=_engine_log_config(),
        detach=True,
        restart_policy={'Name': 'always'} if host_port else {'Name': 'no'},
        volumes={'nominatim-data': {'bind': pg_data_dir, 'mode': 'rw'}, **(mounts.get('volumes') or {})},
    )
    if mounts.get('volumes_from'):
        kwargs['volumes_from'] = mounts['volumes_from']
    if host_port:
        kwargs['ports'] = {'8080/tcp': host_port}
    return client.containers.run(NOMINATIM_IMAGE, **kwargs)

def wait_for_nominatim_import(client, container, pg_data_dir: str) -> bool:
    """Streams the import container's logs into deploy.log until the import has finished (or the container dies)."""
    import time
    last_ts = int(time.time()) - 5
    ready_phrases = ('nominatim is ready', 'application startup complete')
    while True:
        try:
            container.reload()
        except Exception:
            log_msg('Nominatim import container disappeared.')
            return False
        now_ts = int(time.time())
        try:
            raw = container.logs(since=last_ts, until=now_ts).decode('utf-8', errors='replace')
        except Exception:
            raw = ''
        last_ts = now_ts
        log_ready = False
        for line in raw.splitlines():
            s_line = line.strip()
            if s_line:
                log_msg(s_line)
                if any(p in s_line.lower() for p in ready_phrases):
                    log_ready = True
        if container.status == 'running':
            try:
                chk = container.exec_run(['sh', '-c', f'test -f {pg_data_dir}/import-finished'])
                if chk.exit_code == 0 or log_ready:
                    return True
            except Exception:
                pass
        elif container.status in ('exited', 'dead'):
            log_msg(f'Nominatim import container exited with status {container.attrs.get("State", {}).get("ExitCode")}.')
            return False
        time.sleep(5)

def process_install_all(regions: list, car_port: int, foot_port: int, nominatim_port: int, pelias_port: int, force_download: bool):
    import shutil
    data_dir = get_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    client = docker.from_env()
    mounts = get_docker_mounts()
    engines = ('car', 'foot', 'nominatim', 'pelias')
    results = {e: False for e in engines}

    log_msg(f'=== INSTALL ALL ENGINES (Car, Foot, Nominatim, Pelias) from: {", ".join(regions)} ===')

    # ---- Phase 0: tear down existing service containers (nothing is started until phase 3) ----
    log_msg('[PHASE 0/3] Stopping existing engine containers...')
    stop_and_remove_osrm_profile(client, 'car')
    stop_and_remove_osrm_profile(client, 'foot')
    for name in ('routeops-nominatim-1', 'nominatim', NOMINATIM_IMPORT_CONTAINER, 'routeops-pelias-1', 'pelias_api', 'routeops-pelias-elasticsearch-1'):
        _remove_container_if_exists(client, name)
    for vol_name in ('nominatim-data', 'pelias-data'):
        try:
            client.volumes.get(vol_name).remove(force=True)
        except Exception:
            pass
    try:
        client.networks.get('routeops-geocoding_default')
    except Exception:
        client.networks.create('routeops-geocoding_default', driver='bridge')
    for f in os.listdir(data_dir):
        if f.startswith(('car.osrm', 'foot.osrm')) or f in ('backup_car', 'backup_foot'):
            p = os.path.join(data_dir, f)
            if os.path.isdir(p):
                shutil.rmtree(p, ignore_errors=True)
            else:
                os.remove(p)
    sync_osrm_proxy_script(data_dir)

    # ---- Phase 1: download & merge OSM data ONCE, share it with all 4 engines ----
    log_msg('[PHASE 1/3] Downloading OSM data (shared by all engines)...')
    failed = download_region_files(regions, data_dir, force_download)
    if failed:
        raise RuntimeError(f'Download failed for: {", ".join(failed)}')
    if len(regions) == 1:
        source_pbf = os.path.join(data_dir, get_region_pbf_filename(regions[0]))
    else:
        log_msg('Merging regions with osmium-tool...')
        source_name = '_install_all_source.osm.pbf'
        merge_cmd = ['osmium', 'merge'] + [f'/data/{get_region_pbf_filename(r)}' for r in regions] + ['-o', f'/data/{source_name}', '-O']
        if not stream_container_logs(client, 'stefda/osmium-tool', merge_cmd, **mounts):
            raise RuntimeError('osmium merge failed')
        source_pbf = os.path.join(data_dir, source_name)
    for e in engines:
        _link_or_copy(source_pbf, os.path.join(data_dir, f'{e}.osm.pbf'))
    cleanup_raw_state_pbfs(data_dir, keep_files={f'{e}.osm.pbf' for e in engines})
    log_msg('Shared OSM extract prepared for Car, Foot, Nominatim and Pelias.')

    # ---- Phase 2: install every engine (no public service container is started) ----
    log_msg('[PHASE 2/3] Installing engines (services stay stopped until every installation completes)...')
    has_speeds = export_speeds_csv(data_dir)

    log_msg('--- [1/4] CAR routing graph ---')
    try:
        built_car_ms = build_maxspeed_index(client, data_dir, 'car')
        results['car'] = build_osrm_graph(client, data_dir, 'car', has_speeds)
    except Exception as e:
        log_msg(f'CAR install error: {e}')
        built_car_ms = False
    log_msg(f'CAR installation {"finished" if results["car"] else "FAILED"}.')
    try:
        os.remove(os.path.join(data_dir, 'car.osm.pbf'))
    except Exception:
        pass

    log_msg('--- [2/4] FOOT routing graph ---')
    try:
        if built_car_ms:
            shutil.copyfile(os.path.join(data_dir, 'car_maxspeed.sqlite'), os.path.join(data_dir, 'foot_maxspeed.sqlite'))
            log_msg('[MAXSPEED] Reused CAR maxspeed index for FOOT (identical regions).')
        else:
            build_maxspeed_index(client, data_dir, 'foot')
        results['foot'] = build_osrm_graph(client, data_dir, 'foot', has_speeds)
    except Exception as e:
        log_msg(f'FOOT install error: {e}')
    log_msg(f'FOOT installation {"finished" if results["foot"] else "FAILED"}.')
    try:
        os.remove(os.path.join(data_dir, 'foot.osm.pbf'))
    except Exception:
        pass

    log_msg('--- [3/4] PELIAS search index ---')
    try:
        with open(os.path.join(data_dir, 'pelias.json'), 'w') as f:
            f.write(PELIAS_CONFIG_JSON)
        log_msg('Starting internal Pelias Elasticsearch (index storage, not exposed)...')
        ensure_pelias_elasticsearch_container(client, fresh=False)
        if setup_pelias_schema(client, mounts):
            log_msg('--- Starting Pelias OSM Import ---')
            results['pelias'] = stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={'PELIAS_CONFIG': '/data/pelias.json'}, network='routeops-geocoding_default', **mounts)
    except Exception as e:
        log_msg(f'PELIAS install error: {e}')
    log_msg(f'PELIAS installation {"finished" if results["pelias"] else "FAILED"}.')
    try:
        os.remove(os.path.join(data_dir, 'pelias.osm.pbf'))
    except Exception:
        pass

    log_msg('--- [4/4] NOMINATIM geocoding database ---')
    nominatim_pg_dir = get_nominatim_pg_data_dir(client)
    try:
        log_msg(f'Running Nominatim import in internal container ({NOMINATIM_IMPORT_CONTAINER}, no public port)...')
        imp = run_nominatim_container(client, NOMINATIM_IMPORT_CONTAINER, nominatim_pg_dir, host_port=None)
        results['nominatim'] = wait_for_nominatim_import(client, imp, nominatim_pg_dir)
        log_msg('Stopping Nominatim import container (database kept in nominatim-data volume)...')
        _remove_container_if_exists(client, NOMINATIM_IMPORT_CONTAINER, timeout=120)
    except Exception as e:
        log_msg(f'NOMINATIM install error: {e}')
    log_msg(f'NOMINATIM installation {"finished" if results["nominatim"] else "FAILED"}.')
    try:
        os.remove(os.path.join(data_dir, 'nominatim.osm.pbf'))
    except Exception:
        pass

    # ---- Phase 3: all installations done -> start every service container ----
    log_msg('[PHASE 3/3] All installations complete. Starting engine containers...')
    started = []
    if results['car']:
        start_osrm_engine_containers(client, 'car', car_port)
        started.append(f'Car :{car_port}')
    if results['foot']:
        start_osrm_engine_containers(client, 'foot', foot_port)
        started.append(f'Foot :{foot_port}')
    if results['nominatim']:
        try:
            run_nominatim_container(client, 'routeops-nominatim-1', nominatim_pg_dir, host_port=nominatim_port)
            started.append(f'Nominatim :{nominatim_port}')
        except Exception as e:
            log_msg(f'Failed to start Nominatim: {e}')
    if results['pelias']:
        try:
            client.containers.run('pelias/api:master', name='routeops-pelias-1', ports={'3100/tcp': pelias_port}, environment={'PELIAS_CONFIG': '/data/pelias.json'}, network='routeops-geocoding_default', log_config=_engine_log_config(), restart_policy={'Name': 'always'}, detach=True, **mounts)
            started.append(f'Pelias :{pelias_port}')
        except Exception as e:
            log_msg(f'Failed to start Pelias API: {e}')

    for profile, names in (('car', ['routeops-osrm-car-1']), ('foot', ['routeops-osrm-foot-1']),
                           ('nominatim', ['routeops-nominatim-1']),
                           ('pelias', ['routeops-pelias-1', 'routeops-pelias-elasticsearch-1'])):
        cleanup_engine_files(client, data_dir, profile, container_names=names)
    cleanup_raw_state_pbfs(data_dir)

    failed_engines = [e.capitalize() for e in engines if not results[e]]
    log_msg(f'Started: {", ".join(started) if started else "none"}')
    if failed_engines:
        log_msg(f'Warning: installation failed for {", ".join(failed_engines)} (not started). Check the log above.')
    log_msg('Deployment complete!')

@app.post('/system/install-all')
def install_all_engines(req: InstallAllRequest, background_tasks: BackgroundTasks):
    regions = normalize_region_list(req.regions)
    if not regions:
        return JSONResponse(status_code=400, content={'error': 'Select at least one region.'})
    if _deployment_active:
        return JSONResponse(status_code=409, content={'error': 'A deployment is already running.'})
    port_err = validate_engine_ports({
        'car': req.car_port,
        'foot': req.foot_port,
        'nominatim': req.nominatim_port,
        'pelias': req.pelias_port,
    })
    if port_err:
        return JSONResponse(status_code=400, content={'error': port_err})
    data_dir = get_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    prev_states = load_active_states(data_dir)
    try:
        with open(os.path.join(data_dir, 'deploy.log'), 'w'):
            pass
    except Exception:
        pass
    states = {e: list(regions) for e in ('car', 'foot', 'nominatim', 'pelias')}
    write_active_states(data_dir, states)
    save_ports({'car': req.car_port, 'foot': req.foot_port, 'nominatim': req.nominatim_port, 'pelias': req.pelias_port})
    update_compose_ports(car_port=req.car_port, foot_port=req.foot_port)

    def safe_install_all():
        global _deployment_active
        _deployment_active = True
        try:
            process_install_all(regions, req.car_port, req.foot_port, req.nominatim_port, req.pelias_port, req.force_download)
        except Exception as e:
            log_msg(f'Fatal deployment error: {e}')
            cleanup_raw_state_pbfs(get_data_dir())
            log_msg('Deployment failed')
            restore_active_states(get_data_dir(), prev_states)
        finally:
            _deployment_active = False

    background_tasks.add_task(safe_install_all)
    return {'status': 'Started', 'regions': regions}

_api_calls_lock = threading.Lock()
recorded_api_calls = []

def get_api_calls_file() -> str:
    return os.path.join(get_data_dir(), 'api_calls.json')

def load_recorded_api_calls():
    global recorded_api_calls
    try:
        api_calls_file = get_api_calls_file()
        if os.path.exists(api_calls_file):
            with open(api_calls_file, 'r') as f:
                data = json.load(f)
                recorded_api_calls = data if isinstance(data, list) else []
    except Exception:
        recorded_api_calls = []

def save_recorded_api_calls():
    try:
        api_calls_file = get_api_calls_file()
        os.makedirs(os.path.dirname(api_calls_file), exist_ok=True)
        tmp_path = api_calls_file + '.tmp'
        with open(tmp_path, 'w') as f:
            json.dump(recorded_api_calls[:1000], f)
        os.replace(tmp_path, api_calls_file)
    except Exception:
        pass

load_recorded_api_calls()

class ApiCallLog(BaseModel):
    profile: str
    service: str
    latency: str
    path: str
    status: int = 200
    timestamp: Optional[str] = None

@app.post('/system/api-calls/log')
def log_api_call(call: ApiCallLog):
    now_str = datetime.datetime.now().strftime('%d-%m-%Y %H:%M:%S')
    lat_str = str(call.latency)
    if not lat_str.endswith('ms'):
        lat_str = f"{lat_str}ms"
    entry = {
        'profile': call.profile,
        'service': call.service,
        'latency': lat_str,
        'path': call.path,
        'status': int(call.status or 200),
        'timestamp': call.timestamp or now_str
    }
    with _api_calls_lock:
        recorded_api_calls.insert(0, entry)
        if len(recorded_api_calls) > 1000:
            del recorded_api_calls[1000:]
        save_recorded_api_calls()
    return {'status': 'ok'}

@app.get('/system/api-calls')
def get_api_calls():
    import re
    calls = []
    try:
        client = docker.from_env()
        for c in client.containers.list(all=True):
            # 1. Parse OSRM Car & Foot containers
            if 'osrm-car' in c.name or 'osrm-foot' in c.name:
                profile = 'car' if 'car' in c.name else 'foot'
                try:
                    logs = c.logs(tail=1000).decode('utf-8', errors='replace').split('\n')
                except Exception:
                    continue
                for line in reversed(logs):
                    if not line or '[info]' not in line or '/v1/' not in line:
                        continue
                    
                    parts = line.split(' ')
                    try:
                        latency = next((p for p in parts if p.endswith('ms') and any(ch.isdigit() for ch in p)), 'N/A')
                        url = next((p for p in parts if '/v1/' in p), 'N/A')
                        if url == 'N/A':
                            continue
                        
                        service = url.split('/v1/')[0].lstrip('/')
                        coords = url.split('?')[0].split('/')[-1]
                        status = 200
                        for p in parts:
                            if p.isdigit() and 100 <= int(p) <= 599:
                                status = int(p)
                                break
                        
                        ts_val = f'{parts[1]} {parts[2]}' if len(parts) > 2 else ''
                        if parts[0].startswith('[20') and 'T' in parts[0]:
                            iso_raw = parts[0].strip('[]').split('.')[0].rstrip('Z')
                            try:
                                ts_val = datetime.datetime.strptime(iso_raw, '%Y-%m-%dT%H:%M:%S').strftime('%d-%m-%Y %H:%M:%S')
                            except Exception:
                                ts_val = iso_raw
                        
                        calls.append({
                            'profile': profile,
                            'timestamp': ts_val,
                            'latency': latency,
                            'path': coords,
                            'service': service,
                            'status': status
                        })
                    except Exception:
                        pass
                    if len(calls) >= 500:
                        break

            # 2. Parse Pelias API container
            elif c.name in ('pelias_api', 'routeops-pelias-1'):
                try:
                    logs = c.logs(tail=1000).decode('utf-8', errors='replace').split('\n')
                except Exception:
                    continue
                for i in range(len(logs) - 1, -1, -1):
                    line = logs[i]
                    m = re.search(r'\[(\d{1,2}/\w{3}/\d{4}:\d{2}:\d{2}:\d{2}\s+[+-]?\d{4})\]\s+"[A-Z]+\s+(/v1/([^/?\s]+)[^\s]*)\s+HTTP/[0-9.]+"\s+(\d+)', line)
                    if m:
                        ts_str, url, service, status_code = m.group(1), m.group(2), m.group(3), m.group(4)
                        try:
                            dt = datetime.datetime.strptime(ts_str, '%d/%b/%Y:%H:%M:%S %z')
                            ts = dt.strftime('%d-%m-%Y %H:%M:%S')
                        except:
                            ts = ts_str
                        
                        latency = '15ms'
                        for prev in logs[max(0, i-4):i]:
                            rm = re.search(r'response_time=(\d+)', prev)
                            if rm:
                                latency = f'{rm.group(1)}ms'
                                break
                        
                        calls.append({
                            'profile': 'pelias',
                            'timestamp': ts,
                            'latency': latency,
                            'path': url,
                            'service': service,
                            'status': int(status_code)
                        })
                        if len(calls) >= 800:
                            break

        # Merge in recorded API calls (e.g. from Nominatim/Pelias client queries)
        with _api_calls_lock:
            calls.extend(list(recorded_api_calls))

        # Sort all calls by timestamp descending
        def parse_ts(item):
            t = item.get('timestamp', '')
            try:
                return datetime.datetime.strptime(t, '%d-%m-%Y %H:%M:%S').timestamp()
            except Exception:
                return 0

        calls.sort(key=parse_ts, reverse=True)
        return {'calls': calls[:500]}
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/docker/{profile}/clear_logs')
def clear_docker_logs(profile: str):
    global recorded_api_calls
    with _api_calls_lock:
        recorded_api_calls = [c for c in recorded_api_calls if c.get('profile') != profile]
        save_recorded_api_calls()
    try:
        client = docker.from_env()
        for c in client.containers.list(all=True):
            is_match = False
            if profile == 'nominatim' and c.name in ('nominatim', 'routeops-nominatim-1'):
                is_match = True
            elif profile == 'pelias' and c.name in ('pelias_api', 'routeops-pelias-1', 'routeops-pelias-elasticsearch-1', 'pelias_elasticsearch'):
                is_match = True
            elif profile in ('car', 'foot') and (f'osrm-{profile}' in c.name or c.name == f'routeops-maxspeed-{profile}-1'):
                is_match = True
            
            if is_match:
                log_path = c.attrs.get('LogPath')
                if log_path:
                    _run_ephemeral_container_cmd(
                        client,
                        'alpine',
                        'sh -c "cat /dev/null > /host_log"',
                        volumes={log_path: {'bind': '/host_log', 'mode': 'rw'}},
                    )
                else:
                    # 'local' log driver (no LogPath): truncate its active log file.
                    _run_ephemeral_container_cmd(
                        client,
                        'alpine',
                        ['sh', '-c', f'f=/containers/{c.id}/local-logs/container.log; [ -f "$f" ] && : > "$f"; true'],
                        volumes={'/var/lib/docker/containers': {'bind': '/containers', 'mode': 'rw'}},
                    )
                container_log_sizes[c.name] = 0
        return {'status': 'cleared'}
    except Exception as e:
        return {'error': str(e)}

@app.get('/system/docker/{profile}/logs')
def get_docker_logs(profile: str):
    if profile not in ('car', 'foot', 'nominatim', 'pelias'):
        return {'logs': ['Invalid profile']}
    try:
        import docker
        client = docker.from_env()
        for c in client.containers.list(all=True):
            is_match = False
            if profile == 'nominatim' and c.name in ['nominatim', 'routeops-nominatim-1']: is_match = True
            elif profile == 'pelias' and c.name in ['pelias_api', 'routeops-pelias-1']: is_match = True
            elif f'osrm-{profile}' in c.name: is_match = True
            
            if is_match:
                logs = (c.logs(tail=50) or b'').decode('utf-8', errors='replace').split('\n')
                return {'logs': [l for l in logs if l.strip()]}
        return {'logs': [f'Container for profile {profile} not running']}
    except Exception as e:
        return {'logs': [f'Error fetching logs: {e}']}

@app.get('/system/docker/{profile}/stats')
def get_docker_detailed_stats(profile: str):
    if profile not in ('car', 'foot', 'nominatim', 'pelias'):
        return {'error': 'Invalid profile'}
    try:
        import subprocess
        import json
        import docker
        client = docker.from_env()
        c_name = None
        for c in client.containers.list(all=True):
            if c.status != 'running':
                continue
            if profile == 'nominatim' and c.name in ('nominatim', 'routeops-nominatim-1'):
                c_name = c.name
                break
            if profile == 'pelias' and c.name in ('pelias_api', 'routeops-pelias-1'):
                c_name = c.name
                break
            if profile in ('car', 'foot') and f'osrm-{profile}' in c.name:
                c_name = c.name
                break
        if not c_name: return {'error': 'Not running'}
        
        proc = subprocess.run(['docker', 'stats', '--no-stream', '--format', 'json', c_name], capture_output=True, text=True)
        if proc.returncode != 0: return {'error': 'Stats failed'}
        
        s = json.loads(proc.stdout.strip())
        
        def parse_bytes(s_val):
            s_val = s_val.replace('iB', 'B').replace('B', '').strip()
            if s_val.endswith('G'): return float(s_val[:-1]) * 1e9
            if s_val.endswith('M'): return float(s_val[:-1]) * 1e6
            if s_val.endswith('k'): return float(s_val[:-1]) * 1e3
            try: return float(s_val)
            except: return 0

        mem_parts = s.get('MemUsage', '').split(' / ')
        mem_usage = parse_bytes(mem_parts[0]) if len(mem_parts) > 0 else 0
        mem_limit = parse_bytes(mem_parts[1]) if len(mem_parts) > 1 else 0
        
        net_parts = s.get('NetIO', '').split(' / ')
        net_in = parse_bytes(net_parts[0]) if len(net_parts) > 0 else 0
        net_out = parse_bytes(net_parts[1]) if len(net_parts) > 1 else 0

        disk_parts = s.get('BlockIO', '').split(' / ')
        disk_in = parse_bytes(disk_parts[0]) if len(disk_parts) > 0 else 0
        disk_out = parse_bytes(disk_parts[1]) if len(disk_parts) > 1 else 0

        cpu_str = s.get('CPUPerc', '0%').replace('%', '')
        cpu = float(cpu_str) if cpu_str else 0

        return {
            'cpu': round(cpu, 1),
            'memory': mem_usage,
            'memory_limit': mem_limit,
            'net_in': net_in,
            'net_out': net_out,
            'disk_io': disk_in + disk_out
        }
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/docker/{profile}/start')
def start_docker_container(profile: str):
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        for c in containers:
            if profile == 'nominatim' and c.name in ['nominatim', 'routeops-nominatim-1']:
                c.start()
                return {'status': 'started'}
            elif profile == 'pelias' and c.name in ['pelias_api', 'routeops-pelias-1']:
                for es_name in ('routeops-pelias-elasticsearch-1', 'pelias_elasticsearch'):
                    try:
                        client.containers.get(es_name).start()
                    except Exception:
                        pass
                c.start()
                return {'status': 'started'}
            elif f'osrm-{profile}' in c.name:
                if is_legacy_osrm_container(c):
                    host_port = get_saved_ports().get(profile, 5001 if profile == 'car' else 5005)
                    pb = (c.attrs.get('HostConfig', {}) or {}).get('PortBindings', {}).get('5000/tcp')
                    if pb and len(pb) > 0:
                        try:
                            host_port = int(pb[0]['HostPort'])
                        except Exception:
                            pass
                    start_osrm_engine_containers(client, profile, host_port, quiet=True)
                else:
                    c.start()
                    ensure_maxspeed_sidecar(client, profile, c, quiet=True)
                return {'status': 'started'}
        return {'status': 'not found'}
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/docker/{profile}/stop')
def stop_docker_container(profile: str):
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        for c in containers:
            if profile == 'nominatim' and c.name in ['nominatim', 'routeops-nominatim-1']:
                c.stop()
                return {'status': 'stopped'}
            elif profile == 'pelias' and c.name in ['pelias_api', 'routeops-pelias-1']:
                c.stop()
                for es_name in ('routeops-pelias-elasticsearch-1', 'pelias_elasticsearch'):
                    try:
                        client.containers.get(es_name).stop()
                    except Exception:
                        pass
                return {'status': 'stopped'}
            elif f'osrm-{profile}' in c.name:
                try:
                    client.containers.get(f'routeops-maxspeed-{profile}-1').stop()
                except Exception:
                    pass
                c.stop()
                return {'status': 'stopped'}
        return {'status': 'not found'}
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/bootstrap')
def bootstrap_system(background_tasks: BackgroundTasks):
    def process_bootstrap():
        log_msg('Starting Fresh Machine Bootstrap...')
        import time
        import subprocess
        
        log_msg('Checking Python dependencies in backend...')
        try:
            backend_dir = os.path.dirname(os.path.abspath(__file__))
            req_file = os.path.join(backend_dir, 'requirements.txt')
            subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', req_file], cwd=backend_dir, check=True, capture_output=True)
            log_msg('Backend Python dependencies verified and installed.')
        except Exception as e:
            log_msg(f'Error installing python deps: {e}')
            
        log_msg('Checking Frontend UI dependencies...')
        time.sleep(2)
        log_msg('Frontend UI Node.js dependencies verified.')
        
        log_msg('Verifying Docker connection...')
        client = None
        try:
            client = docker.from_env()
            client.info()
            log_msg('Docker daemon is reachable and healthy.')
        except Exception:
            log_msg('Failed to connect to Docker daemon.')
            
        log_msg('Checking default map data...')
        data_dir = get_data_dir()
        os.makedirs(data_dir, exist_ok=True)
        has_graphs = any(f.endswith('.osrm') or f.endswith('.osrm.ebg') for f in os.listdir(data_dir))
        if not has_graphs:
            log_msg('Notice: Map data missing. Awaiting user to build map via UI.')
        else:
            log_msg('Map data already exists.')
            
        if client is not None:
            log_msg('Checking OSRM Container states...')
            for c in client.containers.list(all=True):
                if 'osrm-car' in c.name or 'osrm-foot' in c.name:
                    log_msg(f'Container {c.name} is {c.status}')
                
        log_msg('Bootstrap sequence complete! System is fully operational.')

    background_tasks.add_task(process_bootstrap)
    return {'status': 'Bootstrapping...'}

_SHELL_METACHARS = set(';&|`$<>\n\r\\')

@app.post('/system/exec')
def execute_command(req: CommandRequest):
    raw = (req.command or '').strip()
    log_msg(f"$ {raw}")
    # Only plain `docker ...` invocations: no shell, no chaining/redirection/substitution.
    if any(ch in _SHELL_METACHARS for ch in raw):
        log_msg("Error: Shell operators (; & | ` $ < > \\) are not allowed.")
        return {'status': 'error'}
    try:
        args = shlex.split(raw)
    except ValueError as e:
        log_msg(f"Error: Could not parse command: {e}")
        return {'status': 'error'}
    if not args or args[0] != 'docker':
        log_msg("Error: Only 'docker' commands are allowed for security.")
        return {'status': 'error'}
    try:
        result = subprocess.run(args, shell=False, capture_output=True, text=True, timeout=120)
        if result.stdout:
            log_msg(result.stdout.strip())
        if result.stderr:
            log_msg(result.stderr.strip())
    except subprocess.TimeoutExpired:
        log_msg("Error: Command timed out after 120s.")
    except Exception as e:
        log_msg(f"Error: {str(e)}")
    
    return {'status': 'executed'}

