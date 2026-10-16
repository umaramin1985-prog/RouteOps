import docker
client = docker.from_env()
c = client.containers.list()[0]
log_path = c.attrs['LogPath']
print("Log path:", log_path)
client.containers.run('alpine', 'sh -c "cat /dev/null > /host_log"', remove=True, volumes={log_path: {'bind': '/host_log', 'mode': 'rw'}})
print('Cleared!')
