import re

with open(r'c:\Code\OSRM 2\backend\main.py', 'r', encoding='utf-8') as f:
    content = f.read()

# Replace nominatim logic
old_nom = """        if engines.get("nominatim", True):
            log_msg('Restarting Nominatim to pick up new PBF...')
            try:
                import docker
                docker.from_env().containers.get('nominatim').restart()
                log_msg('Nominatim Restarted!')
            except Exception as e: log_msg(f"Nominatim restart failed: {e}")"""
new_nom = """        if engines.get("nominatim", True):
            log_msg(f'Recreating Nominatim on port {req.nominatim_port}...')
            try:
                import docker
                client = docker.from_env()
                try:
                    c = client.containers.get('nominatim')
                    c.stop()
                    c.remove()
                except:
                    pass
                client.containers.run('mediagis/nominatim:5.3', name='nominatim', ports={'8080/tcp': req.nominatim_port}, environment={'PBF_PATH': '/data/nominatim.osm.pbf', 'NOMINATIM_PASSWORD': 'super_secure_password', 'REPLICATION_URL': 'https://planet.osm.org/replication/hour/'}, network='routeops-geocoding_default', shm_size='2g', restart_policy={'Name': 'always'}, detach=True, volumes={'nominatim-data': {'bind': '/var/lib/postgresql/14/main', 'mode': 'rw'}, **(get_docker_mounts().get('volumes', {}))}, volumes_from=get_docker_mounts().get('volumes_from', None))
                log_msg('Nominatim Recreated!')
            except Exception as e: log_msg(f"Nominatim restart failed: {e}")"""
content = content.replace(old_nom, new_nom)

# Replace pelias logic
old_pel = """        if engines.get("pelias", True):
            log_msg('Rebuilding Pelias Index...')
            try:
                client = docker.from_env()
                stream_container_logs(client, 'pelias/schema:master', ['npm', 'run', 'create_index'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
                stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
                log_msg("--- Pelias Build Finished! ---")
            except Exception as e:
                log_msg(f"Pelias build error: {e}")"""
new_pel = """        if engines.get("pelias", True):
            log_msg(f'Rebuilding Pelias Index and recreating API on port {req.pelias_port}...')
            try:
                client = docker.from_env()
                stream_container_logs(client, 'pelias/schema:master', ['npm', 'run', 'create_index'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
                stream_container_logs(client, 'pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', **get_docker_mounts())
                
                try:
                    c = client.containers.get('pelias_api')
                    c.stop()
                    c.remove()
                except:
                    pass
                client.containers.run('pelias/api:master', name='pelias_api', ports={'4000/tcp': req.pelias_port}, environment={'PELIAS_CONFIG': '/data/pelias.json'}, network='routeops-geocoding_default', restart_policy={'Name': 'always'}, detach=True, **get_docker_mounts())
                
                log_msg("--- Pelias Build & API Restart Finished! ---")
            except Exception as e:
                log_msg(f"Pelias build error: {e}")"""
content = content.replace(old_pel, new_pel)

with open(r'c:\Code\OSRM 2\backend\main.py', 'w', encoding='utf-8') as f:
    f.write(content)

print("Backend patch complete")
