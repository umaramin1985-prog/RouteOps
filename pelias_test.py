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

print("Waiting for Elasticsearch to become ready...")
for _ in range(45):
    try:
        c = client.containers.get('routeops-pelias-elasticsearch-1')
        if c.status == 'running':
            res = c.exec_run('curl -s http://localhost:9200/_cluster/health')
            out = res.output.decode('utf-8', errors='ignore')
            if res.exit_code == 0 and ('yellow' in out or 'green' in out or 'status' in out):
                print("Elasticsearch is healthy and ready!")
                break
    except Exception:
        pass
    time.sleep(2)

print("Preparing schema index...")
try:
    c = client.containers.get('routeops-pelias-elasticsearch-1')
    chk = c.exec_run('curl -s -o /dev/null -w "%{http_code}" http://localhost:9200/pelias')
    if chk.exit_code == 0 and chk.output.decode('utf-8').strip() == '200':
        print("Dropping existing index for clean recreate...")
        c.exec_run('curl -s -X DELETE http://localhost:9200/pelias')
except Exception as e:
    print("Index check notice:", e)

print("Running schema create_index...")
try:
    logs = client.containers.run('pelias/schema:master', ['npm', 'run', 'create_index'], environment={"PELIAS_CONFIG": "/data/pelias.json"}, network='routeops-geocoding_default', volumes={data_dir: {'bind': '/data', 'mode': 'rw'}}, remove=True)
    print(logs.decode())
except Exception as e:
    print("Schema failed:", e)
