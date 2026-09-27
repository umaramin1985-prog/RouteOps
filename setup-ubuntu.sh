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
if command_exists python3; then
    echo "[+] Python 3 is already installed. Version: $(python3 --version)"
else
    echo "[*] Installing Python 3..."
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
