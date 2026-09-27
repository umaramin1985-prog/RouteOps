$ErrorActionPreference = "Stop"

Write-Host "Building OSRM Car Routing Data..."
docker run --rm -v "${PWD}/data:/data" osrm/osrm-backend osrm-extract -p /opt/car.lua /data/car.osm.pbf
docker run --rm -v "${PWD}/data:/data" osrm/osrm-backend osrm-partition /data/car.osrm
docker run --rm -v "${PWD}/data:/data" osrm/osrm-backend osrm-customize /data/car.osrm

Write-Host "Building OSRM Foot Routing Data..."
docker run --rm -v "${PWD}/data:/data" osrm/osrm-backend osrm-extract -p /opt/foot.lua /data/foot.osm.pbf
docker run --rm -v "${PWD}/data:/data" osrm/osrm-backend osrm-partition /data/foot.osrm
docker run --rm -v "${PWD}/data:/data" osrm/osrm-backend osrm-customize /data/foot.osrm

Write-Host "OSRM Data Build Complete!"
