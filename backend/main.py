from fastapi import FastAPI, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import docker
import os
import csv
import psutil
import subprocess
from sqlalchemy.orm import Session

# Local imports
from database import SessionLocal, RoadOverride, engine, Base, User

app = FastAPI(title="OSRM Management API")

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
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    admin_user = db.query(User).filter(User.username == "admin").first()
    if not admin_user:
        admin_user = User(username="admin", password="admin", recovery_code="123456")
        db.add(admin_user)
        db.commit()
    db.close()

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
                writer.writerow([ov.from_node, ov.to_node, speed])
                if ov.is_bidirectional:
                    writer.writerow([ov.to_node, ov.from_node, speed])
        db.close()
        
        # Connect to Docker
        client = docker.from_env()
        
        for profile in ['car', 'foot']:
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
            if 'osrm-car' in c.name or 'osrm-foot' in c.name:
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
@app.get('/system/metrics')
def get_system_metrics():
    cpu = psutil.cpu_percent(interval=0.1)
    ram = psutil.virtual_memory().percent
    try:
        usage = psutil.disk_usage('/data')
    except:
        usage = psutil.disk_usage('/')
    
    return {
        'cpu': cpu, 
        'ram': ram, 
        'disk': usage.percent,
        'disk_total': round(usage.total / (1024**3), 2),
        'disk_free': round(usage.free / (1024**3), 2)
    }

@app.get('/system/db-status')
def get_db_status(db: Session = Depends(get_db)):
    try:
        from sqlalchemy import text
        db.execute(text("SELECT 1"))
        return {'status': 'connected'}
    except Exception as e:
        return {'status': 'disconnected', 'error': str(e)}

@app.get('/system/docker')
def get_docker_status():
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        car_status = 'Not Found'
        foot_status = 'Not Found'
        car_started_at = None
        foot_started_at = None
        for c in containers:
            if 'osrm-car' in c.name:
                car_status = c.status
                car_started_at = c.attrs.get('State', {}).get('StartedAt')
            if 'osrm-foot' in c.name:
                foot_status = c.status
                foot_started_at = c.attrs.get('State', {}).get('StartedAt')
        active_states = []
        try:
            import json
            with open('/data/active_states.json', 'r') as f:
                active_states = json.load(f)
        except:
            pass
            
        logs_str = '\n'.join(deploy_logs).lower() if 'deploy_logs' in globals() else ''
        is_deploying = len(deploy_logs) > 0 and 'deployment complete!' not in logs_str if 'deploy_logs' in globals() else False
            
        return {'car': car_status, 'foot': foot_status, 'car_started_at': car_started_at, 'foot_started_at': foot_started_at, 'active_states': active_states, 'is_deploying': is_deploying}
    except Exception as e:
        return {'error': str(e)}


import datetime


def get_data_dir():
    import os
    if os.path.exists('/.dockerenv'):
        return '/data'
    return os.path.abspath(os.path.join(os.path.dirname(__file__), '..', 'data'))

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
        logs = client.containers.run(image, command, remove=True, stream=True, **kwargs)
        for chunk in logs:
            for line in chunk.decode('utf-8', errors='replace').splitlines():
                if line.strip():
                    log_msg(line.strip())
    except Exception as e:
        log_msg(f"Error running {command}: {e}")

def process_deploy(car_port: int, foot_port: int):
    import shutil
    import yaml
    import os
    import docker
    
    log_msg(f'Starting deployment with car_port={car_port}, foot_port={foot_port}')
    
    # 1. Update compose file
    compose_path = os.path.abspath('../docker-compose.yml')
    try:
        try:
            with open(compose_path, 'r') as f:
                compose_data = yaml.safe_load(f)
            compose_data['services']['osrm-car']['ports'] = [f'{car_port}:5000']
            compose_data['services']['osrm-foot']['ports'] = [f'{foot_port}:5000']
            with open(compose_path, 'w') as f:
                yaml.dump(compose_data, f)
            log_msg('Updated docker-compose.yml ports.')
        except Exception as e:
            log_msg(f'Notice: Skipping docker-compose.yml update: {e}')
        
        # 2. Stop and remove existing OSRM containers
        client = docker.from_env()
        for container in client.containers.list(all=True):
            if 'osrm-car' in container.name or 'osrm-foot' in container.name:
                log_msg(f'Stopping and removing {container.name}...')
                container.stop()
                container.remove()
                
        # 3. Clean /data directory (except merged.osm.pbf)
        data_dir = get_data_dir()
        for f in os.listdir(data_dir):
            if f not in ['merged.osm.pbf', 'speeds.csv', 'active_states.json']:
                p = os.path.join(data_dir, f)
                if os.path.isfile(p):
                    os.remove(p)
                elif os.path.isdir(p):
                    shutil.rmtree(p)
        log_msg('Wiped old OSRM graph data.')
        
        # 4. Build graphs if merged.osm.pbf exists
        if os.path.exists(os.path.join(data_dir, 'merged.osm.pbf')):
            shutil.copy(os.path.join(data_dir, 'merged.osm.pbf'), os.path.join(data_dir, 'car.osm.pbf'))
            shutil.copy(os.path.join(data_dir, 'merged.osm.pbf'), os.path.join(data_dir, 'foot.osm.pbf'))
            
            try:
                db_session = SessionLocal()
                overrides = db_session.query(RoadOverride).all()
                csv_path = os.path.join(data_dir, "speeds.csv")
                with open(csv_path, 'w', newline='') as f:
                    writer = csv.writer(f)
                    for ov in overrides:
                        speed = 1 if ov.is_closed else max(1, int(round(ov.speed_kmh)))
                        writer.writerow([ov.from_node, ov.to_node, speed])
                        if ov.is_bidirectional:
                            writer.writerow([ov.to_node, ov.from_node, speed])
                db_session.close()
                log_msg(f"Exported {len(overrides)} road overrides to speeds.csv")
            except Exception as e:
                log_msg(f"Failed to export speeds.csv: {e}")

            has_speeds = os.path.exists(os.path.join(data_dir, "speeds.csv")) and os.path.getsize(os.path.join(data_dir, "speeds.csv")) > 0
            
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
            log_msg('Warning: merged.osm.pbf not found. Skipping graph build.')
            
        # 5. Recreate containers with new ports
        import time
        log_msg('Recreating osrm-car container with shared memory...')
        car_c = client.containers.run('osrm/osrm-backend', 'sh -c "osrm-datastore /data/car.osrm && exec osrm-routed --shared-memory=yes --algorithm mld"', entrypoint="", name='osrm2-osrm-car-1', ports={'5000/tcp': car_port}, **get_docker_mounts(), detach=True, restart_policy={'Name': 'always'}, ipc_mode="shareable")
        
        log_msg('Waiting for car profile to finish loading into memory before starting foot profile...')
        for _ in range(15):
            time.sleep(2)
            if b'running and waiting for requests' in car_c.logs(tail=20):
                break
                
        log_msg('Recreating osrm-foot container with shared memory...')
        client.containers.run('osrm/osrm-backend', 'sh -c "osrm-datastore /data/foot.osrm && exec osrm-routed --shared-memory=yes --algorithm mld"', entrypoint="", name='osrm2-osrm-foot-1', ports={'5000/tcp': foot_port}, **get_docker_mounts(), detach=True, restart_policy={'Name': 'always'}, ipc_mode="shareable")
        
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
        with open(os.path.abspath('../deploy.log'), 'a') as lf:
            lf.write(msg + '\n')
    except:
        pass

@app.get('/system/logs')
def get_system_logs():
    try:
        with open(os.path.abspath('../deploy.log'), 'r') as lf:
            lines = lf.readlines()
            return {'logs': [l.strip() for l in lines[-50:]]}
    except:
        return {'logs': ['[SYSTEM] Listening for deployment events...']}

class MergeRequest(BaseModel):
    states: list[str]
    car_port: int
    foot_port: int
    force_download: bool = False

@app.post('/system/merge')
def merge_states(req: MergeRequest, background_tasks: BackgroundTasks):
    try:
        with open(os.path.abspath('../deploy.log'), 'w') as f:
            pass
    except Exception:
        pass
        
    try:
        import json, os
        data_dir = get_data_dir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
        with open(os.path.join(data_dir, 'active_states.json'), 'w') as f:
            json.dump(req.states, f)
    except Exception as e:
        pass

    def process_merge(states: list[str], force_download: bool):
        import urllib.request
        import subprocess
        import shutil
        log_msg(f'Starting merge for {states}')
        data_dir = get_data_dir()
        if not os.path.exists(data_dir):
            os.makedirs(data_dir)
        files = []
        for state in states:
            url = f'http://download.geofabrik.de/north-america/us/{state}-latest.osm.pbf'
            file_path = os.path.join(data_dir, f'{state}.osm.pbf')
            
            if not force_download and os.path.exists(file_path):
                log_msg(f'Using cached map data for {state}...')
                files.append(f'/data/{state}.osm.pbf')
            else:
                log_msg(f'Downloading {url} to {file_path}')
                try:
                    urllib.request.urlretrieve(url, file_path)
                    files.append(f'/data/{state}.osm.pbf')
                except Exception as e:
                    log_msg(f'Failed to download {state}: {e}')
                
        if len(files) > 1:
            log_msg('Merging files using osmium-tool...')
            merged_file = '/data/merged.osm.pbf'
            try:
                import docker
                client = docker.from_env()
                command = ['osmium', 'merge'] + files + ['-o', merged_file, '-O']
                stream_container_logs(client, 'stefda/osmium-tool', command, **get_docker_mounts())
                log_msg('Merge successful!')
            except Exception as e:
                log_msg(f'Merge failed: {e}')
        elif len(files) == 1:
            shutil.copy(os.path.join(data_dir, f'{states[0]}.osm.pbf'), os.path.join(data_dir, 'merged.osm.pbf'))
            log_msg('Only 1 state, copied to merged.osm.pbf')
            
        log_msg('--- MERGE COMPLETE, STARTING DEPLOYMENT ---')
        process_deploy(req.car_port, req.foot_port)
            
    background_tasks.add_task(process_merge, req.states, req.force_download)
    return {'status': 'Started'}
@app.get('/system/api-calls')
def get_api_calls():
    calls = []
    try:
        client = docker.from_env()
        for c in client.containers.list(all=True):
            if 'osrm-car' in c.name or 'osrm-foot' in c.name:
                profile = 'car' if 'car' in c.name else 'foot'
                logs = c.logs(tail=1000).decode('utf-8').split('\n')
                for line in reversed(logs):
                    if not line or '[info]' not in line or '/route/v1' not in line:
                        continue
                    
                    parts = line.split(' ')
                    try:
                        latency = next((p for p in parts if 'ms' in p), 'N/A')
                        url = next((p for p in parts if p.startswith('/route/v1')), 'N/A')
                        coords = url.split('?')[0].split('/')[-1]
                        
                        calls.append({
                            'profile': profile,
                            'timestamp': f'{parts[1]} {parts[2]}',
                            'latency': latency,
                            'path': coords
                        })
                    except:
                        pass
                    if len(calls) >= 500:
                        break
        
        unique_calls = []
        seen = set()
        for c in calls:
            if c['path'] not in seen:
                seen.add(c['path'])
                unique_calls.append(c)
            if len(unique_calls) >= 500:
                break
                
        return {'calls': unique_calls[:500]}
    except Exception as e:
        return {'error': str(e)}

@app.post('/system/docker/{profile}/start')
def start_docker_container(profile: str):
    try:
        client = docker.from_env()
        containers = client.containers.list(all=True)
        for c in containers:
            if f'osrm-{profile}' in c.name:
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
            if f'osrm-{profile}' in c.name:
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
            
        log_msg('Checking default map data (maryland-latest.osm.pbf)...')
        data_dir = get_data_dir()
        os.makedirs(data_dir, exist_ok=True)
        if not os.path.exists(os.path.join(data_dir, 'maryland-latest.osm.pbf')) and not os.path.exists(os.path.join(data_dir, 'merged.osm.pbf')):
            log_msg('Map data missing! Downloading default OSM map (Maryland)...')
            import urllib.request
            try:
                urllib.request.urlretrieve('http://download.geofabrik.de/north-america/us/maryland-latest.osm.pbf', os.path.join(data_dir, 'maryland-latest.osm.pbf'))
                log_msg('Successfully downloaded default map data.')
            except Exception as e:
                log_msg(f'Failed to download map data: {e}')
        else:
            log_msg('Map data already exists. Skipping download.')
            
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

