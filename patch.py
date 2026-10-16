import os
import re

main_path = r'c:\Code\OSRM 2\backend\main.py'
with open(main_path, 'r') as f:
    content = f.read()

# 1. Update deploy graphs condition
old_deploy = """        # 4. Build graphs if merged.osm.pbf exists
        if os.path.exists(os.path.join(data_dir, 'merged.osm.pbf')):
            shutil.copy(os.path.join(data_dir, 'merged.osm.pbf'), os.path.join(data_dir, 'car.osm.pbf'))
            shutil.copy(os.path.join(data_dir, 'merged.osm.pbf'), os.path.join(data_dir, 'foot.osm.pbf'))"""

new_deploy = """        # 4. Build graphs if pbf exists
        if os.path.exists(os.path.join(data_dir, 'car.osm.pbf')) or os.path.exists(os.path.join(data_dir, 'foot.osm.pbf')):"""

content = content.replace(old_deploy, new_deploy)

# 2. Update process_merge
old_merge_def = "def process_merge(states: list[str], force_download: bool, engines: dict):"
new_merge_def = "def process_merge(states_dict: dict, force_download: bool, engines: dict):"
content = content.replace(old_merge_def, new_merge_def)

# Replace the inner part of process_merge up to MERGE COMPLETE
merge_logic_pattern = re.compile(r"log_msg\(f'Starting merge for \{states\}'\).*?(?=log_msg\('--- MERGE COMPLETE, STARTING DEPLOYMENT ---'\))", re.DOTALL)

new_merge_logic = """log_msg(f'Starting merge for {states_dict}')
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
                                        lines[-1] = f'Downloading {url} to {file_path} - {pct}% ({speed_str})\\n'
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
            if not states_req or not engines.get(profile, True) and profile not in ["car", "foot"]:
                continue
            
            if profile in ["car", "foot"] and not engines.get("osrm", True):
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
                    from .main import stream_container_logs, get_docker_mounts
                    stream_container_logs(client, 'stefda/osmium-tool', command, **get_docker_mounts())
                    log_msg(f'Merge successful for {profile}!')
                except Exception as e:
                    log_msg(f'Merge failed for {profile}: {e}')
                    
        """

content = merge_logic_pattern.sub(new_merge_logic, content)

# 3. Update process_update
old_update_def = "def process_update(states: list[str], force_download: bool, engines: dict):"
new_update_def = "def process_update(states_dict: dict, force_download: bool, engines: dict):"
content = content.replace(old_update_def, new_update_def)

update_logic_pattern = re.compile(r"log_msg\(f'Starting zero-downtime update for \{states\}'\).*?(?=log_msg\('--- UPDATE MERGE COMPLETE, STARTING HOT-RELOAD ---'\))", re.DOTALL)
# Wait, process_update does not have "UPDATE MERGE COMPLETE". 
# Let's see what it has: it just goes straight to "osrm-extract"
# Let's replace the loop in process_update
update_logic_pattern = re.compile(r"log_msg\(f'Starting zero-downtime update for \{states\}'\).*?(?=has_speeds = )", re.DOTALL)

new_update_logic = """log_msg(f'Starting zero-downtime update for {states_dict}')
""" + new_merge_logic.replace("Starting merge for", "Starting zero-downtime update for") + """
        """

content = update_logic_pattern.sub(new_update_logic, content)

with open(main_path, 'w') as f:
    f.write(content)

print("Patch complete")
