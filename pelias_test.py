import docker
import os
import json
import time

client = docker.from_env()

data_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), 'data'))
if not os.path.exists(data_dir): os.makedirs(data_dir)

pelias_json = {
  "logger": { "level": "info", "timestamp": False },
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
    "openstreetmap": {
      "datapath": "/data",
      "import": [{"filename": "pelias.osm.pbf"}]
    }
  }
}
with open(os.path.join(data_dir, 'pelias.json'), 'w') as f:
    json.dump(pelias_json, f)

try:
    c = client.containers.get('routeops-pelias-elasticsearch-1')
    c.stop()
    c.remove()
except: pass

print("Starting elasticsearch...")
es = client.containers.run('pelias/elasticsearch:7.5.1', name='routeops-pelias-elasticsearch-1', network='routeops-geocoding_default', environment={'discovery.type': 'single-node'}, detach=True, volumes={data_dir: {'bind': '/data', 'mode': 'rw'}})

print("Waiting 15 seconds for ES...")
time.sleep(15)

print("Running schema...")
try:
    logs = client.containers.run('pelias/schema:master', ['npm', 'run', 'create_index'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', volumes={data_dir: {'bind': '/data', 'mode': 'rw'}}, remove=True)
    print(logs.decode())
except Exception as e:
    print("Schema failed:", e)
