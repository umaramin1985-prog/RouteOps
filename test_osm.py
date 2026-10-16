import docker
import os

client = docker.from_env()
data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'data'))

print("Running OSM Import...")
try:
    logs = client.containers.run('pelias/openstreetmap:master', ['npm', 'start'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', volumes={data_dir: {'bind': '/data', 'mode': 'rw'}}, remove=True)
    print(logs.decode())
except Exception as e:
    print("OSM Import failed:", e)
