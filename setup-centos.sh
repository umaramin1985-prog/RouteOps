#!/bin/bash
set -e

echo "======================================"
echo "  RouteOps - CentOS Setup"
echo "======================================"

# Function to check if a command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

echo "[*] Updating system packages..."
sudo yum update -y

# Python check
if command_exists python3 && python3 -m pip --version >/dev/null 2>&1; then
    echo "[+] Python 3 and pip are already installed. Version: $(python3 --version)"
else
    echo "[*] Installing Python 3 and pip..."
    sudo yum install python3 python3-pip unzip -y
fi

# Node.js check
if command_exists node; then
    echo "[+] Node.js is already installed. Version: $(node -v)"
else
    echo "[*] Installing Node.js..."
    curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash -
    sudo yum install -y nodejs
fi

# Docker check
if command_exists docker; then
    echo "[+] Docker is already installed. Version: $(docker --version)"
    read -p "Do you want to (1) Continue Fresh Install or (2) Update Existing Deployment? [1/2] " choice
    if [ "$choice" = "2" ]; then
        echo "[*] Updating production deployment..."
        git pull origin main || { echo "[-] git pull failed!"; exit 1; }
        docker compose -f docker-compose.prod.yml up -d --build || { echo "[-] docker compose failed!"; exit 1; }
        docker image prune -f
        echo "[+] Deployment updated successfully."
        exit 0
    elif [ "$choice" = "1" ]; then
        echo "[*] Tearing down existing deployment to start fresh..."
        docker compose down 2>/dev/null || true
        docker compose -f docker-compose.prod.yml down 2>/dev/null || true
        echo "[*] Cleaning up data folder..."
        sudo rm -rf data/* 2>/dev/null || true
    fi
else
    echo "[*] Installing Docker..."
    sudo yum install -y yum-utils
    sudo yum-config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo yum install docker-ce docker-ce-cli containerd.io docker-compose-plugin -y
    sudo systemctl enable --now docker
    echo "[+] Docker installed and started."
fi

# Unzip check
if ! command_exists unzip; then
    echo "[*] Installing unzip..."
    sudo yum install unzip -y
fi

echo "======================================"
echo "  All prerequisites are installed! "
echo "  Launching main installation script..."
echo "======================================"

python3 install.py
