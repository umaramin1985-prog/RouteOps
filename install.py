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
    run_cmd('docker compose down -v 2>/dev/null || true', ignore_error=True)
    run_cmd('docker compose -f docker-compose.prod.yml down -v 2>/dev/null || true', ignore_error=True)
    if sys.platform.startswith('win'):
        run_cmd('powershell -Command "$containers = docker ps -aq --filter name=routeops; if ($containers) { docker rm -f $containers 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$containersOsrm = docker ps -aq --filter name=osrm; if ($containersOsrm) { docker rm -f $containersOsrm 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$images = docker images -q --filter reference=\\"*routeops*\\"; if ($images) { docker image rm -f $images 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$imagesOsrm = docker images -q --filter reference=\\"*osrm*\\"; if ($imagesOsrm) { docker image rm -f $imagesOsrm 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$volumes = docker volume ls -q --filter name=routeops; if ($volumes) { docker volume rm -f $volumes 2>$null }"', ignore_error=True)
        run_cmd('powershell -Command "$volumesOsrm = docker volume ls -q --filter name=osrm; if ($volumesOsrm) { docker volume rm -f $volumesOsrm 2>$null }"', ignore_error=True)
    else:
        run_cmd('docker rm -f $(docker ps -aq --filter name=routeops) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker rm -f $(docker ps -aq --filter name=osrm) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker image rm -f $(docker images -q --filter reference="*routeops*") 2>/dev/null || true', ignore_error=True)
        run_cmd('docker image rm -f $(docker images -q --filter reference="*osrm*") 2>/dev/null || true', ignore_error=True)
        run_cmd('docker volume rm -f $(docker volume ls -q --filter name=routeops) 2>/dev/null || true', ignore_error=True)
        run_cmd('docker volume rm -f $(docker volume ls -q --filter name=osrm) 2>/dev/null || true', ignore_error=True)
        
    print_step('Cleaning up data folder and database...')
    if sys.platform.startswith('win'):
        run_cmd('powershell -Command "Remove-Item -Path data\\* -Recurse -Force -ErrorAction SilentlyContinue"', ignore_error=True)
        run_cmd('powershell -Command "Remove-Item -Path backend\\osrm_portal.db -Force -ErrorAction SilentlyContinue"', ignore_error=True)
    else:
        run_cmd('sudo rm -rf data/* 2>/dev/null || true', ignore_error=True)
        run_cmd('sudo rm -f backend/osrm_portal.db 2>/dev/null || true', ignore_error=True)


    # 1. Check Required Ports
    print_step('Verifying required ports are available...')
    
    # Check rigid ports first (5173, 5172, 5433)
    rigid_ports = [5173, 5172, 5433]
    ports_in_use = [p for p in rigid_ports if not check_port(p)]
    if ports_in_use:
        print_error(f'The following ports are already in use: {", ".join(map(str, ports_in_use))}')
        print_error('These are required for Frontend, Backend, and DB. Please free these ports.')
        sys.exit(1)

    # Check flexible ports (5001, 5005)
    car_port = 5001
    foot_port = 5005
    
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
    if car_port != 5001 or foot_port != 5005:
        print_step('Updating codebase with new OSRM ports...')
        def replace_in_file(filepath, old_str, new_str):
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
            content = content.replace(old_str, new_str)
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(content)
                
        if car_port != 5001:
            replace_in_file('frontend/src/components/MapDisplay.tsx', '5001', str(car_port))
            replace_in_file('frontend/src/components/EngineSetup.tsx', '5001', str(car_port))
            replace_in_file('docker-compose.yml', '5001:5000', f'{car_port}:5000')
            
        if foot_port != 5005:
            replace_in_file('frontend/src/components/MapDisplay.tsx', '5005', str(foot_port))
            replace_in_file('frontend/src/components/EngineSetup.tsx', '5005', str(foot_port))
            replace_in_file('docker-compose.yml', '5005:5000', f'{foot_port}:5000')
            
        print_success('Codebase ports updated successfully.')

    print_success('All required ports are available.')



    # 3. Check for Docker
    print_step('Verifying Docker installation...')
    run_cmd('docker info', ignore_error=False)
    print_success('Docker is running.')

    # 4. Start Docker Compose
    print_step('Spinning up the OSRM stack via docker-compose.prod.yml...')
    run_cmd('docker compose -f docker-compose.prod.yml up -d --build')
    print_success('Docker containers started successfully.')

    print('\n\033[1;36m===================================================')
    print('  INSTALLATION COMPLETE!  ')
    print('  Frontend UI: http://localhost/dashboard')
    print('  Backend API: http://localhost:5172')
    print('===================================================\033[0m\n')

if __name__ == '__main__':
    main()
