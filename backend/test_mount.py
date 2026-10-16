import docker
client = docker.from_env()
try:
    res = client.containers.run('alpine', 'ls -l /containers', remove=True, volumes={'/var/lib/docker/containers': {'bind': '/containers', 'mode': 'ro'}})
    print(res.decode('utf-8'))
except Exception as e:
    print(e)
