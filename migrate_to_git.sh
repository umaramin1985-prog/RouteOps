#!/bin/bash

echo "==================================================="
echo "  🚀 Starting Git Migration & Data Recovery...   "
echo "==================================================="

cd /home/gis

if [ -d "RouteOps-backup" ]; then
    echo "[-] RouteOps-backup already exists. Please delete it first."
    exit 1
fi

if [ ! -d "RouteOps" ]; then
    echo "[-] RouteOps directory not found in /home/gis."
    exit 1
fi

echo "[1/4] Backing up current RouteOps directory..."
mv RouteOps RouteOps-backup

echo "[2/4] Cloning fresh Git repository..."
git clone https://github.com/umaramin1985-prog/RouteOps.git RouteOps

echo "[3/4] Restoring your Map Data & Database..."
cp -r RouteOps-backup/data RouteOps/
cp RouteOps-backup/backend/osrm_portal.db RouteOps/backend/

echo "[4/4] Making setup scripts executable..."
chmod +x RouteOps/setup-ubuntu.sh
chmod +x RouteOps/setup-centos.sh

echo "==================================================="
echo "  ✅ Migration Complete! Your data is safe."
echo "  Please run the following commands next:"
echo ""
echo "  cd /home/gis/RouteOps"
echo "  ./setup-ubuntu.sh"
echo "  (Remember to choose Option 2!)"
echo "==================================================="
