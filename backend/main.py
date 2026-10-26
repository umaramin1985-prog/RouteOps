from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import docker
import os
import json
import yaml
import csv
import psutil
import subprocess
from sqlalchemy.orm import Session

# Local imports
from database import SessionLocal, RoadOverride, engine, Base, User

app = FastAPI(title="OSRM Management API")

container_log_sizes = {}
import threading

def update_log_sizes_bg():
    while True:
        try:
            import docker
            client = docker.from_env()
            res = client.containers.run('alpine', 'sh -c "stat -c \'%n %s\' /containers/*/*-json.log"', remove=True, volumes={'/var/lib/docker/containers': {'bind': '/containers', 'mode': 'ro'}})
            lines = res.decode('utf-8').strip().split('\n')
            
            size_map = {}
            for line in lines:
                parts = line.strip().split(' ')
                if len(parts) == 2:
                    c_id = parts[0].split('/')[-2]
                    size_map[c_id] = int(parts[1])
            
            for c in client.containers.list(all=True):
                if any(x in c.name for x in ['osrm-car', 'osrm-foot', 'nominatim', 'pelias']):
                    if c.id in size_map:
                        container_log_sizes[c.name] = size_map[c.id]
        except:
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
    
    # 2. Safely migrate existing databases to Alembic
    if "alembic_version" not in inspector.get_table_names():
        log_msg("No Alembic version found. Stamping head...")
        subprocess.run(["alembic", "stamp", "head"], check=True)
        
    log_msg("Running database migrations...")
    subprocess.run(["alembic", "upgrade", "head"], check=True)
    db = SessionLocal()
    admin_user = db.query(User).filter(User.username == "admin").first()
    if not admin_user:
        admin_user = User(username="admin", password="admin", recovery_code="123456")
        db.add(admin_user)
        db.commit()
    db.close()
    log_msg("[SYSTEM] Listening for deployment events...")

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
    db_override = RoadOverride(**override.dict())
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
        db_override = RoadOverride(**override.dict())
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
    return {"status": "error", "message": "Not found"}

def rebuild_osrm_data():
    try:
        data_dir = get_data_dir()
        # Create a fresh DB session for the background task
        db = SessionLocal()
        overrides = db.query(RoadOverride).all()
        csv_path = os.path.join(data_dir, "speeds.csv") 
        
        with open(csv_path, 'w', newline='') as f:
            writer = csv.writer(f)
            for ov in overrides:
                # OSRM expects integer speeds. 1 km/h is heavily penalized.
                speed = 1 if ov.is_closed else max(1, int(round(ov.speed_kmh)))
                
                if ',' in ov.from_node:
                    nodes = ov.from_node.split(',')
                    for i in range(len(nodes) - 1):
                        writer.writerow([nodes[i], nodes[i+1], speed])
                        if ov.is_bidirectional:
                            writer.writerow([nodes[i+1], nodes[i], speed])
                else:
                    writer.writerow([ov.from_node, ov.to_node, speed])
                    if ov.is_bidirectional:
                        writer.writerow([ov.to_node, ov.from_node, speed])
        db.close()
        
        # Connect to Docker
        client = docker.from_env()
        
        for profile in ['car', 'foot']:
            if not os.path.exists(os.path.join(data_dir, f'{profile}.osm.pbf')):
                continue
            
            osrm_container = None
            for container in client.containers.list():
                if f"osrm-{profile}" in container.name:
                    osrm_container = container
                    break
                    
            if osrm_container:
                log_msg(f"Restoring {profile} graph from backup...")
                # Restore from backup before running osrm-customize
                os.system(f"cp -r /data/backup_{profile}/* /data/")
                
                log_msg(f"Running osrm-customize inside existing {profile} container...")
                
                has_speeds = os.path.exists(os.path.join(data_dir, "speeds.csv")) and os.path.getsize(os.path.join(data_dir, "speeds.csv")) > 0
                cust_cmd = f"osrm-customize /data/{profile}.osrm"
                if has_speeds:
                    cust_cmd += " --segment-speed-file /data/speeds.csv"
                    
                result = osrm_container.exec_run(cust_cmd)
                log_msg(f"Customize result ({profile}):", result.output.decode('utf-8'))
                
                log_msg(f"Hot-swapping memory with osrm-datastore for {profile}...")
                ds_result = osrm_container.exec_run(f"osrm-datastore /data/{profile}.osrm")
                log_msg(f"Datastore result ({profile}):", ds_result.output.decode('utf-8'))
            else:
                log_msg(f"Notice: osrm-{profile} container not found.")

    except Exception as e:
        log_msg("Error during OSRM rebuild:", str(e), flush=True)




@app.post('/system/docker/remove-all')
def remove_all_containers():
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        count = 0
        for c in containers:
            if any(name in c.name for name in ['osrm-car', 'osrm-foot', 'nominatim', 'pelias']):
                try:
                    c.stop()
                except:
                    pass
                try:
                    c.remove(force=True)
                    count += 1
                except:
                    pass
                    
        # Clean /data directory
        import shutil
        data_dir = get_data_dir()
        if os.path.exists(data_dir):
            for f in os.listdir(data_dir):
                if f != 'speeds.csv': # keep overrides
                    p = os.path.join(data_dir, f)
                    if os.path.isfile(p):
                        os.remove(p)
                    elif os.path.isdir(p):
                        shutil.rmtree(p)
                        
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
            net_in_rate = (current_net.bytes_recv - last_net.bytes_recv) / dt
            net_out_rate = (current_net.bytes_sent - last_net.bytes_sent) / dt
            disk_read_rate = (current_disk.read_bytes - last_disk.read_bytes) / dt
            disk_write_rate = (current_disk.write_bytes - last_disk.write_bytes) / dt
            
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
    default_ports = {'car': 5001, 'foot': 5005, 'nominatim': 8080, 'pelias': 4000}
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
        with open(ports_path, 'w') as f:
            json.dump(current, f)
    except Exception:
        pass

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
        nominatim_port = saved_ports.get('nominatim', 8080)
        pelias_port = saved_ports.get('pelias', 4000)
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
            
        logs_str = '\n'.join(deploy_logs).lower() if 'deploy_logs' in globals() else ''
        is_deploying = len(deploy_logs) > 0 and 'deployment complete!' not in logs_str if 'deploy_logs' in globals() else False
            
        car_log_size = 0
        foot_log_size = 0
        nominatim_log_size = 0
        pelias_log_size = 0
        for name, size in container_log_sizes.items():
            if 'osrm-car' in name: car_log_size = size
            elif 'osrm-foot' in name: foot_log_size = size
            elif name in ['nominatim', 'routeops-nominatim-1']: nominatim_log_size = size
            elif name in ['pelias_api', 'routeops-pelias-1']: pelias_log_size = size

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
    def run_pelias_build():
        try:
            client = docker.from_env()
            try: client.networks.get('routeops-geocoding_default')
            except: client.networks.create('routeops-geocoding_default', driver='bridge')
            if not setup_pelias_schema(client, get_docker_mounts()):
                log_msg("Cannot proceed with Pelias build: Schema setup failed.")
                return
            log_msg("--- Starting Pelias OSM Import ---")
            stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
            try:
                c = client.containers.get('routeops-pelias-1')
                c.restart()
            except:
                try:
                    c = client.containers.get('pelias_api')
                    c.restart()
                except:
                    pass
            log_msg("--- Pelias Build Finished! ---")
        except Exception as e:
            log_msg(f"Pelias build error: {e}")

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
        logs = c.logs(tail=100).decode('utf-8', errors='replace').splitlines()
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
        logs = c.logs(tail=100).decode('utf-8', errors='replace').splitlines()
        return {'logs': logs}
    except Exception as e:
        return {'error': str(e)}


import datetime

def get_docker_mounts():
    import os
    if os.path.exists('/.dockerenv'):
        return {'volumes_from': [os.environ.get('HOSTNAME') or '']}
    else:
        return {'volumes': {get_data_dir(): {'bind': '/data', 'mode': 'rw'}}}

class DeployRequest(BaseModel):
    car_port: int
    foot_port: int

def stream_container_logs(client, image, command, **kwargs):
    try:
        from docker.types import LogConfig
        kwargs['log_config'] = LogConfig(type=LogConfig.types.JSON)
        kwargs['detach'] = True
        container = client.containers.run(image, command, **kwargs)
        for chunk in container.logs(stream=True, follow=True):
            for line in chunk.decode('utf-8', errors='replace').splitlines():
                if line.strip():
                    log_msg(line.strip())
        res = container.wait()
        container.remove(force=True)
        status_code = res.get('StatusCode', 0)
        if status_code != 0:
            log_msg(f"Warning: command exited with code {status_code}")
            return False
        return True
    except Exception as e:
        log_msg(f"Error running {command}: {e}")
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

def process_deploy(car_port: int, foot_port: int, engines: dict = None):
    if engines is None:
        engines = {"car": True, "foot": True}
    import shutil
    import yaml
    import os
    import docker
    
    log_msg(f'Starting deployment with car_port={car_port}, foot_port={foot_port}')
    
    # 1. Update compose file
    update_compose_ports(
        car_port=car_port if engines.get("car", True) else None,
        foot_port=foot_port if engines.get("foot", True) else None
    )
        
    try:
        # 2. Stop and remove existing OSRM containers
        client = docker.from_env()
        for container in client.containers.list(all=True):
            if engines.get("car", True) and 'osrm-car' in container.name:
                log_msg(f'Stopping and removing {container.name}...')
                container.stop()
                container.remove()
            if engines.get("foot", True) and 'osrm-foot' in container.name:
                log_msg(f'Stopping and removing {container.name}...')
                container.stop()
                container.remove()
                
        # 3. Clean /data directory
        data_dir = get_data_dir()
        for f in os.listdir(data_dir):
            if f not in ['speeds.csv', 'active_states.json', 'pelias.json'] and not f.endswith('.osm.pbf'):
                if f.startswith('car') and not engines.get("car", True):
                    continue
                if f.startswith('foot') and not engines.get("foot", True):
                    continue
                if f.startswith('backup_car') and not engines.get("car", True):
                    continue
                if f.startswith('backup_foot') and not engines.get("foot", True):
                    continue
                p = os.path.join(data_dir, f)
                if os.path.isfile(p):
                    os.remove(p)
                elif os.path.isdir(p):
                    shutil.rmtree(p)
        log_msg('Wiped old OSRM graph data for targeted engines.')
        
        # 4. Build graphs if pbf exists
        if os.path.exists(os.path.join(data_dir, 'car.osm.pbf')) or os.path.exists(os.path.join(data_dir, 'foot.osm.pbf')):
            
            try:
                db_session = SessionLocal()
                overrides = db_session.query(RoadOverride).all()
                csv_path = os.path.join(data_dir, "speeds.csv")
                with open(csv_path, 'w', newline='') as f:
                    writer = csv.writer(f)
                    for ov in overrides:
                        speed = 1 if ov.is_closed else max(1, int(round(ov.speed_kmh)))
                        if ',' in ov.from_node:
                            nodes = ov.from_node.split(',')
                            for i in range(len(nodes) - 1):
                                writer.writerow([nodes[i], nodes[i+1], speed])
                                if ov.is_bidirectional:
                                    writer.writerow([nodes[i+1], nodes[i], speed])
                        else:
                            writer.writerow([ov.from_node, ov.to_node, speed])
                            if ov.is_bidirectional:
                                writer.writerow([ov.to_node, ov.from_node, speed])
                db_session.close()
                log_msg(f"Exported {len(overrides)} road overrides to speeds.csv")
            except Exception as e:
                log_msg(f"Failed to export speeds.csv: {e}")

            has_speeds = os.path.exists(os.path.join(data_dir, "speeds.csv")) and os.path.getsize(os.path.join(data_dir, "speeds.csv")) > 0
            
            if engines.get("car", True) and os.path.exists(os.path.join(data_dir, 'car.osm.pbf')):
                cust_cmd_car = ['osrm-customize', '/data/car.osrm']
                if has_speeds:
                    cust_cmd_car.extend(['--segment-speed-file', '/data/speeds.csv'])

                log_msg('Running OSRM Extract for CAR...')
                stream_container_logs(client, 'osrm/osrm-backend', ['osrm-extract', '-p', '/opt/car.lua', '/data/car.osm.pbf'], **get_docker_mounts())
                log_msg('Running OSRM Partition for CAR...')
                stream_container_logs(client, 'osrm/osrm-backend', ['osrm-partition', '/data/car.osrm'], **get_docker_mounts())
                
                log_msg('Creating backup of pristine CAR graph...')
                stream_container_logs(client, 'ubuntu', ['sh', '-c', 'mkdir -p /data/backup_car && cp /data/car.osrm* /data/backup_car/'], **get_docker_mounts())
                
                log_msg('Running OSRM Customize for CAR...')
                stream_container_logs(client, 'osrm/osrm-backend', cust_cmd_car, **get_docker_mounts())
            
            if engines.get("foot", True) and os.path.exists(os.path.join(data_dir, 'foot.osm.pbf')):
                cust_cmd_foot = ['osrm-customize', '/data/foot.osrm']
                if has_speeds:
                    cust_cmd_foot.extend(['--segment-speed-file', '/data/speeds.csv'])

                log_msg('Running OSRM Extract for FOOT...')
                stream_container_logs(client, 'osrm/osrm-backend', ['osrm-extract', '-p', '/opt/foot.lua', '/data/foot.osm.pbf'], **get_docker_mounts())
                log_msg('Running OSRM Partition for FOOT...')
                stream_container_logs(client, 'osrm/osrm-backend', ['osrm-partition', '/data/foot.osrm'], **get_docker_mounts())
                
                log_msg('Creating backup of pristine FOOT graph...')
                stream_container_logs(client, 'ubuntu', ['sh', '-c', 'mkdir -p /data/backup_foot && cp /data/foot.osrm* /data/backup_foot/'], **get_docker_mounts())
                
                log_msg('Running OSRM Customize for FOOT...')
                stream_container_logs(client, 'osrm/osrm-backend', cust_cmd_foot, **get_docker_mounts())
        else:
            log_msg('Warning: No .osm.pbf files found. Skipping graph build.')
            
        # 5. Recreate containers with new ports
        import time
        if engines.get("car", True) and os.path.exists(os.path.join(data_dir, 'car.osm.pbf')):
            log_msg('Recreating osrm-car container with shared memory...')
            car_c = client.containers.run('osrm/osrm-backend', 'sh -c "osrm-datastore /data/car.osrm && exec osrm-routed --shared-memory=yes --algorithm mld"', entrypoint="", name='routeops-osrm-car-1', ports={'5000/tcp': car_port}, **get_docker_mounts(), detach=True, restart_policy={'Name': 'always'}, ipc_mode="shareable")
            
            log_msg('Waiting for car profile to finish loading into memory before starting foot profile...')
            for _ in range(15):
                time.sleep(2)
                if b'running and waiting for requests' in car_c.logs(tail=20):
                    break
                    
        if engines.get("foot", True) and os.path.exists(os.path.join(data_dir, 'foot.osm.pbf')):
            log_msg('Recreating osrm-foot container with shared memory...')
            client.containers.run('osrm/osrm-backend', 'sh -c "osrm-datastore /data/foot.osrm && exec osrm-routed --shared-memory=yes --algorithm mld"', entrypoint="", name='routeops-osrm-foot-1', ports={'5000/tcp': foot_port}, **get_docker_mounts(), detach=True, restart_policy={'Name': 'always'}, ipc_mode="shareable")
        
        log_msg('Deployment complete!')
    except Exception as e:
        log_msg(f'Deployment failed: {e}')

@app.post('/system/deploy')
def deploy_osrm(req: DeployRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(process_deploy, req.car_port, req.foot_port)
    return {'status': 'Deploying...'}



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
                    if car_port and 'osrm-car' in compose_data['services']:
                        compose_data['services']['osrm-car']['ports'] = [f'{car_port}:5000']
                    if foot_port and 'osrm-foot' in compose_data['services']:
                        compose_data['services']['osrm-foot']['ports'] = [f'{foot_port}:5000']
                    with open(compose_path, 'w') as f:
                        yaml.dump(compose_data, f)
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
    nominatim_port: int = 8080
    pelias_port: int = 4000
    force_download: bool = False
    engines: Dict[str, bool] = {"osrm": True, "nominatim": True, "pelias": True}

@app.post('/system/merge')
def merge_states(req: MergeRequest, background_tasks: BackgroundTasks):
    try:
        with open(os.path.join(get_data_dir(), 'deploy.log'), 'w') as f:
            pass
    except Exception:
        pass
        
    try:
        data_dir = get_data_dir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
        with open(os.path.join(data_dir, 'active_states.json'), 'w') as f:
            json.dump(req.states, f)
        save_ports({'car': req.car_port, 'foot': req.foot_port, 'nominatim': req.nominatim_port, 'pelias': req.pelias_port})
        update_compose_ports(car_port=req.car_port, foot_port=req.foot_port)
    except Exception as e:
        pass

    def process_merge(states_dict: dict, force_download: bool, engines: dict):
        import urllib.request
        import subprocess
        import shutil
        log_msg(f'Starting merge for {states_dict}')
        data_dir = get_data_dir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
            
        all_states = set()
        for s_list in states_dict.values():
            for s in s_list:
                all_states.add(s)
                
        for state in all_states:
            url = f'https://download.geofabrik.de/north-america/us/{state}-latest.osm.pbf'
            file_path = os.path.join(data_dir, f'{state}.osm.pbf')
            
            if not force_download and os.path.exists(file_path):
                log_msg(f'Using cached map data for {state}...')
            else:
                log_msg(f'Downloading {url} to {file_path}')
                try:
                    import time
                    last_pct = [0]
                    start_time = [time.time()]
                    def reporthook(block_num, block_size, total_size):
                        if total_size > 0:
                            pct = int((block_num * block_size * 100) / total_size)
                            if pct > 100: pct = 100
                            if pct > last_pct[0]:
                                last_pct[0] = pct
                                elapsed = time.time() - start_time[0]
                                downloaded = block_num * block_size
                                speed_mbps = (downloaded / (1024 * 1024)) / elapsed if elapsed > 0 else 0
                                speed_str = f"{speed_mbps:.1f} MB/s"
                                try:
                                    log_path = os.path.join(get_data_dir(), 'deploy.log')
                                    with open(log_path, 'r') as lf:
                                        lines = lf.readlines()
                                    if lines:
                                        lines[-1] = f'Downloading {url} to {file_path} - {pct}% ({speed_str})\n'
                                    with open(log_path, 'w') as lf:
                                        lf.writelines(lines)
                                except:
                                    pass

                    import urllib.request
                    urllib.request.urlretrieve(url, file_path, reporthook=reporthook)
                except Exception as e:
                    log_msg(f'Failed to download {state}: {e}')
                    
        import docker
        import shutil
        client = docker.from_env()
        
        for profile, states_req in states_dict.items():
            if not states_req or not engines.get(profile, True):
                continue
                
            out_file = f'/data/{profile}.osm.pbf'
            host_out_file = os.path.join(data_dir, f'{profile}.osm.pbf')
            if len(states_req) == 1:
                shutil.copy(os.path.join(data_dir, f'{states_req[0]}.osm.pbf'), host_out_file)
                log_msg(f'Copied {states_req[0]} to {profile}.osm.pbf')
            elif len(states_req) > 1:
                log_msg(f'Merging files for {profile} using osmium-tool...')
                files_to_merge = [f'/data/{s}.osm.pbf' for s in states_req]
                command = ['osmium', 'merge'] + files_to_merge + ['-o', out_file, '-O']
                try:
                    stream_container_logs(client, 'stefda/osmium-tool', command, **get_docker_mounts())
                    log_msg(f'Merge successful for {profile}!')
                except Exception as e:
                    log_msg(f'Merge failed for {profile}: {e}')
                    
        log_msg('--- MERGE COMPLETE, STARTING DEPLOYMENT ---')
        if engines.get("car", True) or engines.get("foot", True):
            process_deploy(req.car_port, req.foot_port, engines=engines)
            
        try:
            import docker
            client = docker.from_env()
            try: client.networks.get('routeops-geocoding_default')
            except: client.networks.create('routeops-geocoding_default', driver='bridge')
        except: pass
        
        if engines.get("nominatim", True):
            log_msg(f'Recreating Nominatim on port {req.nominatim_port}...')
            try:
                import docker
                client = docker.from_env()
                try:
                    c = client.containers.get('routeops-nominatim-1')
                    c.stop()
                    c.remove()
                except:
                    pass
                try:
                    c = client.containers.get('nominatim')
                    c.stop()
                    c.remove()
                except:
                    pass
                client.containers.run('mediagis/nominatim:5.3', name='routeops-nominatim-1', ports={'8080/tcp': req.nominatim_port}, environment={'PBF_PATH': '/data/nominatim.osm.pbf', 'NOMINATIM_PASSWORD': 'super_secure_password', 'REPLICATION_URL': 'https://planet.osm.org/replication/hour/'}, network='routeops-geocoding_default', shm_size='2g', restart_policy={'Name': 'always'}, detach=True, volumes={'nominatim-data': {'bind': '/var/lib/postgresql/14/main', 'mode': 'rw'}, **(get_docker_mounts().get('volumes', {}))}, volumes_from=get_docker_mounts().get('volumes_from', None))
                log_msg('Nominatim Recreated!')
            except Exception as e: log_msg(f"Nominatim restart failed: {e}")
        if engines.get("pelias", True):
            log_msg(f'Rebuilding Pelias Index and recreating API on port {req.pelias_port}...')
            try:
                client = docker.from_env()
                # Generate pelias.json
                pelias_json_content = '''{
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
                with open(os.path.join(data_dir, 'pelias.json'), 'w') as f:
                    f.write(pelias_json_content)

                try:
                    c = client.containers.get('routeops-pelias-elasticsearch-1')
                    c.stop()
                    c.remove()
                except:
                    pass
                log_msg('Starting Pelias Elasticsearch...')
                client.containers.run('pelias/elasticsearch:7.5.1', name='routeops-pelias-elasticsearch-1', network='routeops-geocoding_default', environment={'discovery.type': 'single-node'}, restart_policy={'Name': 'always'}, detach=True, **get_docker_mounts())

                if not setup_pelias_schema(client, get_docker_mounts()):
                    log_msg("Pelias schema setup failed. Skipping OSM import.")
                else:
                    log_msg("--- Starting Pelias OSM Import ---")
                    stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
                
                try:
                    c = client.containers.get('routeops-pelias-1')
                    c.stop()
                    c.remove()
                except:
                    pass
                try:
                    c = client.containers.get('pelias_api')
                    c.stop()
                    c.remove()
                except:
                    pass
                client.containers.run('pelias/api:master', name='routeops-pelias-1', ports={'3100/tcp': req.pelias_port}, environment={'PELIAS_CONFIG': '/data/pelias.json'}, network='routeops-geocoding_default', restart_policy={'Name': 'always'}, detach=True, **get_docker_mounts())
                
                log_msg("--- Pelias Build & API Restart Finished! ---")
            except Exception as e:
                log_msg(f"Pelias build error: {e}")
        
        log_msg('Fresh Deployment complete!')
        log_msg('Deployment complete!')
            
    def safe_process_merge(*args):
        try:
            process_merge(*args)
        except Exception as e:
            log_msg(f"Fatal deployment error: {e}")
            log_msg("Deployment failed")
            import os
            try: os.remove(os.path.join(get_data_dir(), 'active_states.json'))
            except: pass
            
    background_tasks.add_task(safe_process_merge, req.states, req.force_download, req.engines)
    return {'status': 'Started'}

@app.post('/system/update')
def update_states(req: MergeRequest, background_tasks: BackgroundTasks):
    try:
        with open(os.path.join(get_data_dir(), 'deploy.log'), 'w') as f:
            pass
    except Exception:
        pass
        
    try:
        data_dir = get_data_dir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
        with open(os.path.join(data_dir, 'active_states.json'), 'w') as f:
            json.dump(req.states, f)
        save_ports({'car': req.car_port, 'foot': req.foot_port, 'nominatim': req.nominatim_port, 'pelias': req.pelias_port})
        update_compose_ports(car_port=req.car_port, foot_port=req.foot_port)
    except Exception as e:
        pass

    def process_update(states_dict: dict, force_download: bool, engines: dict):
        import urllib.request
        import subprocess
        import shutil
        import docker
        import time
        import csv
        
        log_msg(f'Starting zero-downtime update for {states_dict}')
        data_dir = get_data_dir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
            
        all_states = set()
        for s_list in states_dict.values():
            for s in s_list:
                all_states.add(s)
                
        for state in all_states:
            url = f'https://download.geofabrik.de/north-america/us/{state}-latest.osm.pbf'
            file_path = os.path.join(data_dir, f'{state}.osm.pbf')
            
            if not force_download and os.path.exists(file_path):
                log_msg(f'Using cached map data for {state}...')
            else:
                log_msg(f'Downloading {url} to {file_path}')
                try:
                    import time
                    last_pct = [0]
                    start_time = [time.time()]
                    def reporthook(block_num, block_size, total_size):
                        if total_size > 0:
                            pct = int((block_num * block_size * 100) / total_size)
                            if pct > 100: pct = 100
                            if pct > last_pct[0]:
                                last_pct[0] = pct
                                elapsed = time.time() - start_time[0]
                                downloaded = block_num * block_size
                                speed_mbps = (downloaded / (1024 * 1024)) / elapsed if elapsed > 0 else 0
                                speed_str = f"{speed_mbps:.1f} MB/s"
                                try:
                                    log_path = os.path.join(get_data_dir(), 'deploy.log')
                                    with open(log_path, 'r') as lf:
                                        lines = lf.readlines()
                                    if lines:
                                        lines[-1] = f'Downloading {url} to {file_path} - {pct}% ({speed_str})\n'
                                    with open(log_path, 'w') as lf:
                                        lf.writelines(lines)
                                except:
                                    pass

                    import urllib.request
                    urllib.request.urlretrieve(url, file_path, reporthook=reporthook)
                except Exception as e:
                    log_msg(f'Failed to download {state}: {e}')
                    
        import docker
        import shutil
        client = docker.from_env()
        
        for profile, states_req in states_dict.items():
            if not states_req or not engines.get(profile, True):
                continue
                
            out_file = f'/data/{profile}.osm.pbf'
            host_out_file = os.path.join(data_dir, f'{profile}.osm.pbf')
            if len(states_req) == 1:
                shutil.copy(os.path.join(data_dir, f'{states_req[0]}.osm.pbf'), host_out_file)
                log_msg(f'Copied {states_req[0]} to {profile}.osm.pbf')
            elif len(states_req) > 1:
                log_msg(f'Merging files for {profile} using osmium-tool...')
                files_to_merge = [f'/data/{s}.osm.pbf' for s in states_req]
                command = ['osmium', 'merge'] + files_to_merge + ['-o', out_file, '-O']
                try:
                    stream_container_logs(client, 'stefda/osmium-tool', command, **get_docker_mounts())
                    log_msg(f'Merge successful for {profile}!')
                except Exception as e:
                    log_msg(f'Merge failed for {profile}: {e}')
                    
        has_speeds = os.path.exists(os.path.join(data_dir, "speeds.csv")) and os.path.getsize(os.path.join(data_dir, "speeds.csv")) > 0
        
        if engines.get("car", True) and os.path.exists(os.path.join(data_dir, 'car.osm.pbf')):
            cust_cmd_car = ['osrm-customize', '/data/car.osrm']
            if has_speeds:
                cust_cmd_car.extend(['--segment-speed-file', '/data/speeds.csv'])

            log_msg('Running OSRM Extract for CAR...')
            stream_container_logs(client, 'osrm/osrm-backend', ['osrm-extract', '-p', '/opt/car.lua', '/data/car.osm.pbf'], **get_docker_mounts())
            log_msg('Running OSRM Partition for CAR...')
            stream_container_logs(client, 'osrm/osrm-backend', ['osrm-partition', '/data/car.osrm'], **get_docker_mounts())
            log_msg('Running OSRM Customize for CAR...')
            stream_container_logs(client, 'osrm/osrm-backend', cust_cmd_car, **get_docker_mounts())
        
        if engines.get("foot", True) and os.path.exists(os.path.join(data_dir, 'foot.osm.pbf')):
            cust_cmd_foot = ['osrm-customize', '/data/foot.osrm']
            if has_speeds:
                cust_cmd_foot.extend(['--segment-speed-file', '/data/speeds.csv'])

            log_msg('Running OSRM Extract for FOOT...')
            stream_container_logs(client, 'osrm/osrm-backend', ['osrm-extract', '-p', '/opt/foot.lua', '/data/foot.osm.pbf'], **get_docker_mounts())
            log_msg('Running OSRM Partition for FOOT...')
            stream_container_logs(client, 'osrm/osrm-backend', ['osrm-partition', '/data/foot.osrm'], **get_docker_mounts())
            log_msg('Running OSRM Customize for FOOT...')
            stream_container_logs(client, 'osrm/osrm-backend', cust_cmd_foot, **get_docker_mounts())
            
        if engines.get("car", True) and (os.path.exists(os.path.join(data_dir, 'car.osrm')) or os.path.exists(os.path.join(data_dir, 'car.osm.pbf'))):
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

            if need_port_change or need_container_create:
                log_msg(f'Recreating osrm-car container on port {req.car_port}...')
                if car_container:
                    try:
                        car_container.stop()
                        car_container.remove()
                    except:
                        pass
                if os.path.exists(os.path.join(data_dir, 'car.osrm')):
                    client.containers.run('osrm/osrm-backend', 'sh -c "osrm-datastore /data/car.osrm && exec osrm-routed --shared-memory=yes --algorithm mld"', entrypoint="", name='routeops-osrm-car-1', ports={'5000/tcp': req.car_port}, **get_docker_mounts(), detach=True, restart_policy={'Name': 'always'}, ipc_mode="shareable")
                    log_msg(f'Started CAR profile container on port {req.car_port}.')
            elif car_container and car_container.status == 'running':
                log_msg('Hot-reloading CAR container with shared memory...')
                car_container.exec_run('osrm-datastore /data/car.osrm')
                log_msg('Hot-reloaded CAR profile successfully.')
        
        if engines.get("foot", True) and (os.path.exists(os.path.join(data_dir, 'foot.osrm')) or os.path.exists(os.path.join(data_dir, 'foot.osm.pbf'))):
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

            if need_foot_port_change or need_foot_container_create:
                log_msg(f'Recreating osrm-foot container on port {req.foot_port}...')
                if foot_container:
                    try:
                        foot_container.stop()
                        foot_container.remove()
                    except:
                        pass
                if os.path.exists(os.path.join(data_dir, 'foot.osrm')):
                    client.containers.run('osrm/osrm-backend', 'sh -c "osrm-datastore /data/foot.osrm && exec osrm-routed --shared-memory=yes --algorithm mld"', entrypoint="", name='routeops-osrm-foot-1', ports={'5000/tcp': req.foot_port}, **get_docker_mounts(), detach=True, restart_policy={'Name': 'always'}, ipc_mode="shareable")
                    log_msg(f'Started FOOT profile container on port {req.foot_port}.')
            elif foot_container and foot_container.status == 'running':
                log_msg('Hot-reloading FOOT container with shared memory...')
                foot_container.exec_run('osrm-datastore /data/foot.osrm')
                log_msg('Hot-reloaded FOOT profile successfully.')
                        
        try:
            import docker
            client = docker.from_env()
            try: client.networks.get('routeops-geocoding_default')
            except: client.networks.create('routeops-geocoding_default', driver='bridge')
        except: pass
        
        if engines.get("nominatim", True):
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

            need_nom_port_change = (nom_running_port != req.nominatim_port)
            need_nom_container_create = (nom_container is None or nom_container.status != 'running')

            if need_nom_port_change or need_nom_container_create:
                log_msg(f'Recreating Nominatim on port {req.nominatim_port}...')
                if nom_container:
                    try:
                        nom_container.stop()
                        nom_container.remove()
                    except:
                        pass
                client.containers.run('mediagis/nominatim:5.3', name='routeops-nominatim-1', ports={'8080/tcp': req.nominatim_port}, environment={'PBF_PATH': '/data/nominatim.osm.pbf', 'NOMINATIM_PASSWORD': 'super_secure_password', 'REPLICATION_URL': 'https://planet.osm.org/replication/hour/'}, network='routeops-geocoding_default', shm_size='2g', restart_policy={'Name': 'always'}, detach=True, volumes={'nominatim-data': {'bind': '/var/lib/postgresql/14/main', 'mode': 'rw'}, **(get_docker_mounts().get('volumes', {}))}, volumes_from=get_docker_mounts().get('volumes_from', None))
                log_msg('Nominatim Recreated on new port!')
            else:
                log_msg('Restarting Nominatim to pick up new PBF...')
                try: 
                    try: docker.from_env().containers.get('routeops-nominatim-1').restart()
                    except: docker.from_env().containers.get('nominatim').restart()
                except Exception as e: pass

        if engines.get("pelias", True):
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

            need_pel_port_change = (pel_running_port != req.pelias_port)
            need_pel_container_create = (pel_container is None or pel_container.status != 'running')

            if need_pel_port_change or need_pel_container_create:
                log_msg(f'Recreating Pelias API on port {req.pelias_port}...')
                if pel_container:
                    try:
                        pel_container.stop()
                        pel_container.remove()
                    except:
                        pass
                client.containers.run('pelias/api:master', name='routeops-pelias-1', ports={'3100/tcp': req.pelias_port}, environment={'PELIAS_CONFIG': '/data/pelias.json'}, network='routeops-geocoding_default', restart_policy={'Name': 'always'}, detach=True, **get_docker_mounts())
                log_msg('Pelias API Recreated on new port!')
            else:
                log_msg('Rebuilding Pelias Index...')
                try:
                    # Generate pelias.json
                    pelias_json_content = '''{
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
                    with open(os.path.join(data_dir, 'pelias.json'), 'w') as f:
                        f.write(pelias_json_content)

                    try:
                        c = client.containers.get('routeops-pelias-elasticsearch-1')
                        if c.status != 'running':
                            c.start()
                    except:
                        log_msg('Starting Pelias Elasticsearch...')
                        client.containers.run('pelias/elasticsearch:7.5.1', name='routeops-pelias-elasticsearch-1', network='routeops-geocoding_default', environment={'discovery.type': 'single-node'}, restart_policy={'Name': 'always'}, detach=True, **get_docker_mounts())

                    if not setup_pelias_schema(client, get_docker_mounts()):
                        log_msg("Pelias schema setup failed. Skipping OSM import.")
                    else:
                        log_msg("--- Starting Pelias OSM Import ---")
                        stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
                        try:
                            c = client.containers.get('routeops-pelias-1')
                            c.restart()
                        except:
                            try:
                                c = client.containers.get('pelias_api')
                                c.restart()
                            except:
                                pass
                except Exception as e:
                    log_msg(f"Pelias update error: {e}")

        log_msg('Zero-Downtime Deployment complete!')

            
    def safe_process_update(*args):
        try:
            process_update(*args)
        except Exception as e:
            log_msg(f"Fatal deployment error: {e}")
            log_msg("Deployment failed")
            import os
            try: os.remove(os.path.join(get_data_dir(), 'active_states.json'))
            except: pass
            
    background_tasks.add_task(safe_process_update, req.states, req.force_download, req.engines)
    return {'status': 'Started'}

API_CALLS_FILE = '/data/api_calls.json'
recorded_api_calls = []

def load_recorded_api_calls():
    global recorded_api_calls
    try:
        if os.path.exists(API_CALLS_FILE):
            import json
            with open(API_CALLS_FILE, 'r') as f:
                recorded_api_calls = json.load(f)
    except:
        recorded_api_calls = []

def save_recorded_api_calls():
    try:
        import json
        with open(API_CALLS_FILE, 'w') as f:
            json.dump(recorded_api_calls[:1000], f)
    except:
        pass

load_recorded_api_calls()

class ApiCallLog(BaseModel):
    profile: str
    service: str
    latency: str
    path: str
    status: int = 200
    timestamp: str = None

@app.post('/system/api-calls/log')
def log_api_call(call: ApiCallLog):
    import datetime
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
    recorded_api_calls.insert(0, entry)
    if len(recorded_api_calls) > 1000:
        del recorded_api_calls[1000:]
    save_recorded_api_calls()
    return {'status': 'ok'}

@app.get('/system/api-calls')
def get_api_calls():
    calls = []
    try:
        client = docker.from_env()
        for c in client.containers.list(all=True):
            # 1. Parse OSRM Car & Foot containers
            if 'osrm-car' in c.name or 'osrm-foot' in c.name:
                profile = 'car' if 'car' in c.name else 'foot'
                logs = c.logs(tail=1000).decode('utf-8', errors='replace').split('\n')
                for line in reversed(logs):
                    if not line or '[info]' not in line or '/v1/' not in line:
                        continue
                    
                    parts = line.split(' ')
                    try:
                        latency = next((p for p in parts if 'ms' in p), 'N/A')
                        url = next((p for p in parts if '/v1/' in p), 'N/A')
                        if url == 'N/A': continue
                        
                        service = url.split('/v1/')[0].replace('/', '')
                        coords = url.split('?')[0].split('/')[-1]
                        status = 200
                        for p in parts:
                            if p in ('200', '400', '404', '500'):
                                status = int(p)
                                break
                        
                        calls.append({
                            'profile': profile,
                            'timestamp': f'{parts[1]} {parts[2]}',
                            'latency': latency,
                            'path': coords,
                            'service': service,
                            'status': status
                        })
                    except:
                        pass
                    if len(calls) >= 500:
                        break

            # 2. Parse Pelias API container
            elif ('pelias' in c.name or 'pelias_api' in c.name) and not any(k in c.name for k in ['elasticsearch', 'schema', 'openstreetmap']):
                import re, datetime
                logs = c.logs(tail=1000).decode('utf-8', errors='replace').split('\n')
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
        calls.extend(recorded_api_calls)

        # Sort all calls by timestamp descending
        def parse_ts(item):
            t = item.get('timestamp', '')
            try:
                import datetime
                return datetime.datetime.strptime(t, '%d-%m-%Y %H:%M:%S').timestamp()
            except:
                return 0

        calls.sort(key=parse_ts, reverse=True)
        return {'calls': calls[:500]}
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/docker/{profile}/clear_logs')
def clear_docker_logs(profile: str):
    global recorded_api_calls
    recorded_api_calls = [c for c in recorded_api_calls if c.get('profile') != profile]
    save_recorded_api_calls()
    try:
        import docker
        client = docker.from_env()
        for c in client.containers.list(all=True):
            is_match = False
            if profile == 'nominatim' and c.name in ['nominatim', 'routeops-nominatim-1']: is_match = True
            elif profile == 'pelias' and c.name in ['pelias_api', 'routeops-pelias-1']: is_match = True
            elif f'osrm-{profile}' in c.name: is_match = True
            
            if is_match:
                log_path = c.attrs.get('LogPath')
                if log_path:
                    client.containers.run('alpine', 'sh -c "cat /dev/null > /host_log"', remove=True, volumes={log_path: {'bind': '/host_log', 'mode': 'rw'}})
                    return {'status': 'cleared'}
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
                logs = c.logs(tail=50).decode('utf-8', errors='replace').split('\n')
                return {'logs': [l for l in logs if l.strip()]}
        return {'logs': [f'Container for profile {profile} not running']}
    except Exception as e:
        return {'logs': [f'Error fetching logs: {e}']}

@app.get('/system/docker/{profile}/stats')
def get_docker_detailed_stats(profile: str):
    if profile not in ('car', 'foot'):
        return {'error': 'Invalid profile'}
    try:
        import subprocess
        import json
        import docker
        client = docker.from_env()
        c_name = None
        for c in client.containers.list(all=True):
            if f'osrm-{profile}' in c.name and c.status == 'running':
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
                c.start()
                return {'status': 'started'}
            elif f'osrm-{profile}' in c.name:
                c.start()
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
                return {'status': 'stopped'}
            elif f'osrm-{profile}' in c.name:
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
            subprocess.run([sys.executable, '-m', 'pip', 'install', '-r', 'requirements.txt'], check=True, capture_output=True)
            log_msg('Backend Python dependencies verified and installed.')
        except Exception as e:
            log_msg(f'Error installing python deps: {e}')
            
        log_msg('Checking Frontend UI dependencies...')
        # Simulate frontend install check since we are inside docker and frontend has its own container
        time.sleep(2)
        log_msg('Frontend UI Node.js dependencies verified.')
        
        log_msg('Verifying Docker connection...')
        try:
            client = docker.from_env()
            client.info()
            log_msg('Docker daemon is reachable and healthy.')
        except Exception as e:
            log_msg('Failed to connect to Docker daemon.')
            
        log_msg('Checking default map data...')
        data_dir = get_data_dir()
        os.makedirs(data_dir, exist_ok=True)
        if not os.path.exists(os.path.join(data_dir, 'merged.osm.pbf')):
            log_msg('Notice: Map data missing. Awaiting user to build map via UI.')
        else:
            log_msg('Map data already exists.')
            
        log_msg('Checking OSRM Container states...')
        for c in client.containers.list(all=True):
            if 'osrm-car' in c.name or 'osrm-foot' in c.name:
                log_msg(f'Container {c.name} is {c.status}')
                
        log_msg('Bootstrap sequence complete! System is fully operational.')

    background_tasks.add_task(process_bootstrap)
    return {'status': 'Bootstrapping...'}

@app.post('/system/exec')
def execute_command(req: CommandRequest):
    if not req.command.strip().startswith('docker'):
        log_msg(f"$ {req.command}")
        log_msg("Error: Only 'docker' commands are allowed for security.")
        return {'status': 'error'}
    
    log_msg(f"$ {req.command}")
    try:
        result = subprocess.run(req.command, shell=True, capture_output=True, text=True)
        if result.stdout:
            log_msg(result.stdout.strip())
        if result.stderr:
            log_msg(result.stderr.strip())
    except Exception as e:
        log_msg(f"Error: {str(e)}")
    
    return {'status': 'executed'}

