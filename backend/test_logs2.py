import docker
client = docker.from_env()
c = client.containers.list()[0]
print(c.attrs['LogPath'])
import os
try:
    print(os.path.getsize(c.attrs['LogPath']))
except Exception as e:
    print(e)
