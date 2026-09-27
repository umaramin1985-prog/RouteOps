import os
import sys
import subprocess
import time

def print_step(msg):
    print(f'\n\033[1;34m[*] {msg}\033[0m')

def print_success(msg):
    print(f'\033[1;32m[+] {msg}\033[0m')

def print_error(msg):
    print(f'\033[1;31m[-] {msg}\033[0m')

def run_cmd(cmd, cwd=None, ignore_error=False):
    print(f'\033[90m> {cmd}\033[0m')  # Print the exact command being executed
    try:
        subprocess.run(cmd, shell=True, check=True, cwd=cwd)
    except subprocess.CalledProcessError as e:
        if not ignore_error:
            print_error(f'Command failed: {cmd}')
            sys.exit(1)

import socket

def check_port(port):
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        try:
            s.bind(('127.0.0.1', port))
            return True
        except socket.error:
            return False

def main():
    print('\033[1;36m===================================================')
    print('      RouteOps Setup - Fresh Machine Install      ')
    print('===================================================\033[0m')

    # 0. Check Required Ports
    print_step('Verifying required ports are available...')
    
    # Check rigid ports first (5173, 8000, 5432)
    rigid_ports = [5173, 8000, 5432]
    ports_in_use = [p for p in rigid_ports if not check_port(p)]
    if ports_in_use:
        print_error(f'The following ports are already in use: {", ".join(map(str, ports_in_use))}')
        print_error('These are required for Frontend, Backend, and DB. Please free these ports.')
        sys.exit(1)

    # Check flexible ports (5002, 5003)
    car_port = 5002
    foot_port = 5003
    
    while not check_port(car_port):
        print_error(f'Port {car_port} (OSRM Car Engine) is currently in use.')
        try:
            car_port = int(input('Enter a new available port for OSRM Car Engine: '))
        except ValueError:
            print_error("Please enter a valid number.")

    while not check_port(foot_port):
        print_error(f'Port {foot_port} (OSRM Foot Engine) is currently in use.')
        try:
            foot_port = int(input('Enter a new available port for OSRM Foot Engine: '))
        except ValueError:
            print_error("Please enter a valid number.")

    # Apply new ports to files if they changed
    if car_port != 5002 or foot_port != 5003:
        print_step('Updating codebase with new OSRM ports...')
        def replace_in_file(filepath, old_str, new_str):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            content = content.replace(old_str, new_str)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
                
        if car_port != 5002:
            replace_in_file('frontend/src/components/MapDisplay.tsx', '5002', str(car_port))
            replace_in_file('frontend/src/components/EngineSetup.tsx', '5002', str(car_port))
            replace_in_file('docker-compose.yml', '5002:5000', f'{car_port}:5000')
            
        if foot_port != 5003:
            replace_in_file('frontend/src/components/MapDisplay.tsx', '5003', str(foot_port))
            replace_in_file('frontend/src/components/EngineSetup.tsx', '5003', str(foot_port))
            replace_in_file('docker-compose.yml', '5003:5000', f'{foot_port}:5000')
            
        print_success('Codebase ports updated successfully.')

    print_success('All required ports are available.')

    # 1. Install Backend Dependencies
    print_step('Installing backend Python dependencies...')
    run_cmd(f'{sys.executable} -m pip install --upgrade -r requirements.txt', cwd='backend')
    print_success('Backend dependencies installed and updated to the latest versions.')

    # 2. Install Frontend Dependencies
    print_step('Installing frontend Node.js dependencies...')
    if sys.platform == 'win32':
        run_cmd('npm.cmd install', cwd='frontend')
        run_cmd('npm.cmd update', cwd='frontend')
    else:
        run_cmd('npm install', cwd='frontend')
        run_cmd('npm update', cwd='frontend')
    print_success('Frontend dependencies installed and updated to the latest versions.')

    # 3. Check for Docker
    print_step('Verifying Docker installation...')
    run_cmd('docker info', ignore_error=False)
    print_success('Docker is running.')

    # 4. Bootstrap Data Directory
    print_step('Preparing data directory...')
    os.makedirs('data', exist_ok=True)
    if not os.path.exists('data/maryland-latest.osm.pbf') and not os.path.exists('data/merged.osm.pbf'):
        print('Downloading default OSM map (Maryland) for initial bootstrap...')
        import urllib.request
        try:
            urllib.request.urlretrieve('http://download.geofabrik.de/north-america/us/maryland-latest.osm.pbf', 'data/maryland-latest.osm.pbf')
            print_success('Downloaded default map data.')
        except Exception as e:
            print_error(f'Failed to download map data: {e}')
    else:
        print_success('Map data already exists. Skipping download.')

    # 5. Start Docker Compose
    print_step('Spinning up the OSRM stack via docker-compose...')
    run_cmd('docker compose up -d')
    print_success('Docker containers started successfully.')

    print('\n\033[1;36m===================================================')
    print('  INSTALLATION COMPLETE!  ')
    print('  Frontend UI: http://localhost:5173/dashboard')
    print('  Backend API: http://localhost:8000')
    print('===================================================\033[0m\n')

if __name__ == '__main__':
    main()
