#!/bin/bash
set -e

echo "======================================"
echo "  RouteOps - Ubuntu Setup"
echo "======================================"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

echo "[*] Updating system packages..."
sudo apt update -y

# Python check
if command_exists python3 && python3 -m pip --version >/dev/null 2>&1; then
    echo "[+] Python 3 and pip are already installed. Version: $(python3 --version)"
else
    echo "[*] Installing Python 3 and pip..."
    sudo apt install python3 python3-pip python3-venv unzip -y
fi

# Node.js check
if command_exists node; then
    echo "[+] Node.js is already installed. Version: $(node -v)"
else
    echo "[*] Installing Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs
fi

# Docker check
if command_exists docker; then
    echo "[+] Docker is already installed. Version: $(docker --version)"
    read -p "Do you want to (1) Continue Fresh Install or (2) Update Existing Deployment? [1/2] " choice
    if [ "$choice" = "2" ]; then
        echo "[*] Updating production deployment..."
        git pull origin main || echo "[-] git pull failed! (If you downloaded a ZIP, this is normal. Ensure you manually copy the latest files here.)"
        docker compose -f docker-compose.prod.yml up -d --build || { echo "[-] docker compose failed!"; exit 1; }
        docker image prune -f
        echo "[+] Deployment updated successfully."
        exit 0
    elif [ "$choice" = "1" ]; then
        echo "[*] Tearing down existing deployment to start fresh..."
        docker compose down -v --rmi all --remove-orphans 2>/dev/null || true
        docker compose -f docker-compose.prod.yml down -v --rmi all --remove-orphans 2>/dev/null || true
        # Aggressively remove any lingering routeops containers, images, and volumes
        docker rm -f $(docker ps -aq --filter name=routeops) 2>/dev/null || true
        docker rm -f $(docker ps -aq --filter name=osrm) 2>/dev/null || true
        docker image rm -f $(docker images -q --filter reference="*routeops*") 2>/dev/null || true
        docker image rm -f $(docker images -q --filter reference="*osrm*") 2>/dev/null || true
        docker volume rm -f $(docker volume ls -q --filter name=routeops) 2>/dev/null || true
        docker volume rm -f $(docker volume ls -q --filter name=osrm) 2>/dev/null || true
        echo "[*] Cleaning up data folder and database..."
        sudo rm -rf data/* 2>/dev/null || true
        sudo rm -f backend/osrm_portal.db 2>/dev/null || true
    fi
else
    echo "[*] Installing Docker..."
    sudo apt install docker.io docker-compose-v2 -y
    sudo systemctl enable --now docker
    echo "[+] Docker installed and started."
fi

# Unzip check
if ! command_exists unzip; then
    echo "[*] Installing unzip..."
    sudo apt install unzip -y
fi

echo "======================================"
echo "  All prerequisites are installed! "
echo "  Launching main installation script..."
echo "======================================"

python3 install.py
