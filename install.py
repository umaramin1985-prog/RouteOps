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

    # 0. Tear down existing containers to ensure a clean slate
    print_step('Tearing down existing deployment if present...')
    run_cmd('docker compose down -v --rmi all --remove-orphans 2>/dev/null || true', ignore_error=True)
    run_cmd('docker compose -f docker-compose.prod.yml down -v --rmi all --remove-orphans 2>/dev/null || true', ignore_error=True)
    run_cmd('docker compose -f docker-compose.geocoding.yml down -v --rmi all --remove-orphans 2>/dev/null || true', ignore_error=True)
    if sys.platform.startswith('win'):
        run_cmd('powershell -Command "$containers = docker ps -aq --filter name=routeops; if ($containers) { docker rm -f $containers 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$containersOsrm = docker ps -aq --filter name=osrm; if ($containersOsrm) { docker rm -f $containersOsrm 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$containersNom = docker ps -aq --filter name=nominatim; if ($containersNom) { docker rm -f $containersNom 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$containersPel = docker ps -aq --filter name=pelias; if ($containersPel) { docker rm -f $containersPel 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$images = docker images -q --filter reference=\\"*routeops*\\"; if ($images) { docker image rm -f $images 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$imagesOsrm = docker images -q --filter reference=\\"*osrm*\\"; if ($imagesOsrm) { docker image rm -f $imagesOsrm 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$volumes = docker volume ls -q --filter name=routeops; if ($volumes) { docker volume rm -f $volumes 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$volumesOsrm = docker volume ls -q --filter name=osrm; if ($volumesOsrm) { docker volume rm -f $volumesOsrm 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "docker volume rm -f nominatim-data pelias-data 2>$null"', ignore_error=True)
    else:
        run_cmd('docker rm -f $(docker ps -aq --filter name=routeops) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker rm -f $(docker ps -aq --filter name=osrm) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker rm -f $(docker ps -aq --filter name=nominatim) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker rm -f $(docker ps -aq --filter name=pelias) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker image rm -f $(docker images -q --filter reference="*routeops*") 2>/dev/null || true', ignore_error=True)
        run_cmd('docker image rm -f $(docker images -q --filter reference="*osrm*") 2>/dev/null || true', ignore_error=True)
        run_cmd('docker volume rm -f $(docker volume ls -q --filter name=routeops) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker volume rm -f $(docker volume ls -q --filter name=osrm) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker volume rm -f nominatim-data pelias-data 2>/dev/null || true', ignore_error=True)
        
    print_step('Cleaning up data folder and database...')
    if sys.platform.startswith('win'):
        run_cmd('powershell -Command "Remove-Item -Path data\\* -Recurse -Force -ErrorAction SilentlyContinue"', ignore_error=True)
        run_cmd('powershell -Command "Remove-Item -Path backend\\osrm_portal.db* -Force -ErrorAction SilentlyContinue"', ignore_error=True)
    else:
        run_cmd('sudo rm -rf data/* 2>/dev/null || true', ignore_error=True)
        run_cmd('sudo rm -f backend/osrm_portal.db* 2>/dev/null || true', ignore_error=True)


    # 1. Check Required Ports
    print_step('Verifying required ports are available...')
    
    # Check rigid ports used by docker-compose.prod.yml (80 frontend, 5172 backend, 5433 db)
    rigid_ports = [80, 5172, 5433]
    ports_in_use = [p for p in rigid_ports if not check_port(p)]
    if ports_in_use:
        print_error(f'The following ports are already in use: {", ".join(map(str, ports_in_use))}')
        print_error('These are required for Frontend (80), Backend (5172), and DB (5433). Please free these ports.')
        sys.exit(1)

    # Check flexible engine ports (Car=5001, Foot=5005, Nominatim=5003, Pelias=5002)
    reserved_ports = {80, 5172, 5173, 5433, 8000, 9200}
    default_engine_ports = [
        ('car', 'OSRM Car Engine', 5001),
        ('foot', 'OSRM Foot Engine', 5005),
        ('nominatim', 'Nominatim Geocoder', 5003),
        ('pelias', 'Pelias Search API', 5002),
    ]
    chosen_ports = {}
    for key, label, default_port in default_engine_ports:
        candidate = default_port
        while True:
            if candidate < 1 or candidate > 65535:
                print_error(f'Port {candidate} ({label}) must be between 1 and 65535.')
            elif candidate in reserved_ports:
                print_error(f'Port {candidate} ({label}) is reserved by RouteOps internal services.')
            elif candidate in chosen_ports.values():
                print_error(f'Port {candidate} is already assigned to another RouteOps engine.')
            elif not check_port(candidate):
                print_error(f'Port {candidate} ({label}) is currently in use.')
            else:
                chosen_ports[key] = candidate
                break
            try:
                candidate = int(input(f'Enter a new available port for {label}: '))
            except ValueError:
                print_error('Please enter a valid number.')
                candidate = -1

    # Persist custom engine ports via data/ports.json (read by backend & synced to UI)
    if any(chosen_ports[k] != d for k, _, d in default_engine_ports):
        print_step('Saving custom engine ports to data/ports.json...')
        import json
        os.makedirs('data', exist_ok=True)
        with open(os.path.join('data', 'ports.json'), 'w', encoding='utf-8') as f:
            json.dump(chosen_ports, f)
        print_success('Custom engine ports saved successfully.')

    print_success('All required ports are available.')



    # 3. Check for Docker
    print_step('Verifying Docker installation...')
    run_cmd('docker info', ignore_error=False)
    print_success('Docker is running.')

    # 4. Start Docker Compose
    print_step('Spinning up the OSRM stack via docker-compose.prod.yml...')
    run_cmd('docker compose -f docker-compose.prod.yml up -d --build')
    
    print_success('Docker containers started successfully.')

    # 5. Clean up unnecessary build artifacts and dangling Docker resources
    print_step('Cleaning up unnecessary Docker build artifacts and temporary files...')
    run_cmd('docker container prune -f', ignore_error=True)
    run_cmd('docker image prune -f', ignore_error=True)
    run_cmd('docker builder prune -f', ignore_error=True)
    print_success('Post-installation cleanup complete.')

    print('\n\033[1;36m===================================================')
    print('  INSTALLATION COMPLETE!  ')
    print('  Frontend UI: http://localhost/dashboard')
    print('  Backend API: http://localhost:5172')
    print('===================================================\033[0m\n')

if __name__ == '__main__':
    main()
