# RouteOps v2.4.0 🚗 🗺️

RouteOps is a powerful, full-stack transportation management system built around the **Open Source Routing Machine (OSRM)** and self-hosted **Pelias / Nominatim** geocoding engines. It provides a sleek dark/light-mode web dashboard to deploy routing and geocoding engines for the **Entire Planet**, **Continents**, **World Countries**, or specific **US States** on-the-fly, calculate routes (Car & Foot), search addresses locally, and instantly apply dynamic road closures with **zero-downtime hot-swapping**.

## 🚀 What's New in v2.4.0
*   **One-Click Install All Engines (Shared OSM Data & Deferred Startup):** Provision **Car**, **Foot**, **Nominatim**, and **Pelias** together from a single shared OSM download (`POST /api/system/install-all`). All four installations run sequentially using internal build/import helpers and only publish/start the live engine containers once every installation has completed.
*   **Single-Road OSM `max_speed` (`mph` & `kph`) Enrichment:** Direct calls to OSRM Car (`:5001`) and Foot (`:5005`) `/route/v1/...` endpoints (plus `/api/osrm/...`) include `"max_speed": {"mph": <float>, "kph": <float>}` strictly from OpenStreetMap `maxspeed` tags whenever the route stays on a single road—including zero-length routes where pickup and dropoff are the same location.
*   **Global Planet, Continents, Countries & US States Catalog:** Added full global coverage to the Engine Setup selector (`Entire Planet` from `planet.openstreetmap.org`, all 8 Continents, 190+ World Countries across Americas, Europe, Asia, Africa, and Oceania, and all 53 US States & Territories from Geofabrik) with category filter tabs and bounding-box map navigation.
*   **Strictly Local Geocoding & Reverse Geocoding:** All place searches, autocomplete queries, map click lookups, waypoint dragging, and "What's here?" reverse geocoding on the Live Map are now served strictly and exclusively by installed local **Pelias** or **Nominatim** container instances. All external public third-party web APIs (Photon Komoot, OpenStreetMap public Nominatim, BigDataCloud) have been completely removed for 100% self-hosted privacy and air-gapped reliability.
*   **Live Map Geocoder Indicator & Status Badge:** The Live Map search bar now features a real-time badge displaying the active local geocoding engine (`Pelias` or `Nominatim`) with live connectivity status (green online / red offline) and descriptive search placeholder hints.
*   **Pelias Indexing & Console Log Parsing Fix:** Resolved false-positive error coloring in the Engine Setup deployment console where normal progress updates reporting `failed_records=0` during OpenStreetMap indexing turned log lines red. Enhanced console syntax highlighter with emerald success notifications and amber warnings.
*   **Select / Deselect All Regions:** Added one-click "Select Entire Planet", "Select Visible", and "Unselect All" options across all Engine Setup modal tabs (Car, Foot, Nominatim, Pelias) for rapid batch provisioning.
*   **Port Configuration Persistence & Port Standardization:** Resolved an issue where customized port assignments for routing and geocoding containers reverted back to defaults upon reload. Standardized default host ports for local geocoders to avoid system collisions: **Pelias** is now mapped to default port `5002` (was `4000`), and **Nominatim** is now mapped to default port `5003` (was `8080`).
*   **Automated Post-Installation Cleanup:** After each Docker engine (`Car`, `Foot`, `Nominatim`, `Pelias`) completes installation or zero-downtime updates, the platform automatically removes temporary raw and merged `.osm.pbf` files, clears internal container staging/cache directories (`/nominatim/*.pbf`, `/tmp/*`, `/var/tmp/*`, npm/apt caches), and prunes exited helper containers and dangling Docker images/build caches—reclaiming gigabytes of disk space automatically.

## 🌟 Features

*   **One-Click Global Deployment & Auto-Cleanup:** Automatically download map data (OSM `.pbf` from Planet OSM or Geofabrik) for the **Entire Planet**, any **Continent**, any **Country**, or any **US State**, spin up dedicated Docker containers, and automatically purge temporary `.osm.pbf` files, container caches, and ephemeral build containers upon completion.
*   **Install All Engines at Once:** The **Install All Engines** button (Engines Setup → Docker Container Status) lets you pick the OSM regions once and installs Car, Foot, Nominatim and Pelias from the same downloaded data, one after another. No engine container is started until every installation has finished; then all four are started together.
*   **Zero-Downtime Map Updates:** Add or remove states on-the-fly using the "Update States (Zero Downtime)" feature. The backend intelligently compiles new maps and swaps them into shared memory without dropping active API requests. Includes an automatic RAM safeguard that falls back to standard deployment if memory is low.
*   **Zero-Downtime Hot-Swapping:** Close roads directly from the map UI. The backend uses `osrm-customize` and `osrm-datastore` via Shared Memory to instantly patch the routing engine in real-time without taking the server offline.
*   **Strictly Self-Hosted Geocoding:** Integrated address search and reverse geocoding powered strictly by local **Pelias** and **Nominatim** containers with zero remote web requests.
*   **Active Route Edits Management:** Monitor and manage thousands of hot-swapped road closures and speed adjustments in a dedicated, paginated grid with real-time search filtering.
*   **Multi-Profile Routing:** Seamlessly switch between Car (driving) and Foot (walking) routing profiles.
*   **Advanced Navigation & Debugging:** Avoid tolls, calculate alternative routes, view detailed turn-by-turn navigation instructions, and inspect raw, unformatted JSON API responses directly from the OSRM backend.
*   **Road Max Speed in OSRM Responses:** Direct calls to the Car (`:5001`) and Foot (`:5005`) OSRM `/route/v1/...` endpoints (as well as `GET /api/osrm/{car|foot}/route/v1/...`) automatically include `"max_speed": {"mph": <float>, "kph": <float>}` on each route in `routes[]` **only when the route stays on a single road** (`{"mph": null, "kph": null, "unlimited": true}` for OSM `maxspeed=none`, and omitted on multi-road routes). Speed limits resolve in strict priority order: (1) active Road Editor override, (2) explicit OpenStreetMap `maxspeed` tag, and (3) OSM `highway=*` road-type fallback when `maxspeed` is missing in OSM (`motorway` 65 mph, `motorway_link`/`trunk_link` ramps 35 mph, `trunk` 55 mph, `primary` 45 mph, `secondary` 35 mph, `tertiary` 30 mph, `residential` 25 mph, `service`/`living_street` 15 mph, pedestrian paths 3.1 mph / 5.0 km/h) — keeping the Live Map Road Editor and OSRM API 1:1 in sync, including when pickup and dropoff are at the same location (`0.0 mi`).
*   **Real-Time System Telemetry:** Monitor whole-server CPU, RAM, Disk I/O, and Network statistics directly from the dashboard using integrated metric streaming.
*   **Beautiful UI:** A modern, glassy, fully responsive React interface built for command centers, structured across dedicated tabs (Engines Setup, Live Map, and Active Edits).

## 🏗️ Architecture

*   **Frontend:** React (Vite), TypeScript, Leaflet (Map rendering)
*   **Backend:** Python (FastAPI), SQLAlchemy (SQLite persistent `/data/osrm_portal.db` by default, or PostgreSQL / PostGIS via `DATABASE_URL`), Docker SDK
*   **Geocoding:** Pelias (Elasticsearch 7 + Node.js API) & Nominatim (mediagis)
*   **Database:** Fully automated schema migrations via **Alembic**.
*   **Engine:** OSRM (Open Source Routing Machine) running via Docker (Project `routeops`)

### 🔌 Default Ports Matrix

| Service | Default Port | Configurable? | Description |
|---|---|---|---|
| Frontend UI (Production) | `80` | Yes (in `docker-compose.prod.yml`) | Web portal served by Nginx |
| Frontend UI (Dev) | `5173` | Yes (in `docker-compose.yml`) | Vite Dev Server |
| Backend API (Production) | `5172` (Host) -> `8000` (Container) | Yes | FastAPI REST API & Docker SDK controller |
| Backend API (Dev) | `8000` (Host) -> `8000` (Container) | Yes | Local FastAPI server |
| PostgreSQL / PostGIS | `5433` (Host) -> `5432` (Container) | Yes | Spatial database container (optional via `DATABASE_URL`) |
| OSRM Car Engine | `5001` (Host) -> `5000` (Container) | Yes (via UI & `install.py`) | Car driving routing profile (with OSM `max_speed` proxy) |
| OSRM Foot Engine | `5005` (Host) -> `5000` (Container) | Yes (via UI & `install.py`) | Foot walking routing profile (with OSM `max_speed` proxy) |
| Nominatim Geocoding | `5003` (Host) -> `8080` (Container) | Yes (via UI, `install.py` & compose) | Self-hosted address search & reverse geocoding |
| Pelias API | `5002` (Host) -> `3100` (Container) | Yes (via UI, `install.py` & compose) | Self-hosted autocomplete & reverse geocoding |
| Pelias Elasticsearch | `9200` | Fixed internal | Elasticsearch 7 backend for Pelias |

## 🚀 Prerequisites

To run this project, you must have the following installed on your machine:
*   **Docker:** (Docker Desktop on Windows, or native Docker engine on Linux)
*   **Python 3.10+**
*   **Node.js (v20.19+ or v22 LTS)**

*(Note: Running this project natively on a Linux machine is highly recommended over Windows WSL2, as compiling OSRM graph data is extremely CPU and I/O intensive.)*

## 🛠️ Installation & Setup / Updates

### Automated Setup & Updater (Recommended)
We provide dual-purpose, zero-touch scripts tailored for different operating systems. These scripts intelligently act as both **Fresh Installers** and **Production Updaters**. 

Choose the script that matches your server's OS:

**For Ubuntu:**
```bash
sudo bash setup-ubuntu.sh
```

**For CentOS / RHEL / Alma Linux:**
```bash
sudo bash setup-centos.sh
```

**For Windows:**
*(Open PowerShell as Administrator)*
```powershell
.\setup-windows.ps1
```

**How it works:**
When you run the script (and Docker is already installed), you will be prompted to choose an installation path:
`Do you want to (1) Continue Fresh Install or (2) Update Existing Deployment? [1/2]`

*   **Option 1 (Fresh Install):** ⚠️ **Warning: Destructive.** This option will aggressively tear down your existing Docker containers and completely wipe your compiled `data/` folder and your `osrm_portal.db` database. Choose this only if you want to start over from a completely blank slate.
*   **Option 2 (Update Existing Deployment):** ✅ **Recommended for Updates.** This option will safely run `git pull` to fetch the latest code from your repository, rebuild your production Docker containers (`docker-compose.prod.yml`), and automatically migrate your database schema. **Your map data and active edits are perfectly preserved.**

### Production Deployment (Manual)
The setup scripts handle production deployment automatically if you choose the update route. However, to run the application in a highly optimized production environment manually, simply run:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Once complete, access the portal at:
*   **Frontend UI & API Proxy:** `http://localhost/dashboard`

### Manual Setup

If you prefer to run the components manually outside of Docker:

**1. Backend Setup**
Navigate to the `backend` directory, install the Python dependencies, and start the FastAPI server:
```bash
cd backend
pip install -r requirements.txt
python -m uvicorn main:app --reload
```

**2. Frontend Setup**
Open a new terminal, navigate to the `frontend` directory, install the Node dependencies, and start the Vite development server:
```bash
cd frontend
npm install
npm run dev
```

## 🔐 Default Credentials
By default, the management portal is locked behind a login screen to prevent unauthorized access.
*   **Username:** `admin`
*   **Password:** `admin`

## 🕹️ Usage Guide

1.  **Deploy / Update Engines:** Go to the **Engines Setup** tab on the top navigation bar:
    - **Install All Engines:** Select regions once (Planet, Continents, Countries, or US States) and configure ports to build **Car**, **Foot**, **Nominatim**, and **Pelias** from a single shared OSM download. Containers start together only after all installations complete.
    - **Update States (Zero Downtime):** Per-engine configuration that compiles new map data and swaps it into shared memory instantly without interrupting active traffic (with automatic fallback to fresh setup if available RAM is low).
    - **Destroy Existing Containers & Deploy Fresh Setup:** Stops the selected engine's service, wipes old graph/index data, and performs a clean installation from scratch.
2.  **Calculate a Route:** Go to the **Live Map** tab. Click on the map or search via your local Pelias/Nominatim geocoder to set an Origin, Destination, and up to 8 intermediate stops. Click the **JSON** button in the route summary to view and copy the raw API request and response.
3.  **Adjust Speed or Close a Road:** Once a route is drawn, click or right-click on any segment along the route line (across single-leg or multi-stop routes) to set a custom speed limit (`1–200 MPH`, one-way or bidirectional) or close the road completely. Changes hot-swap into OSRM shared memory immediately without container restarts.
4.  **Manage Active Edits:** Navigate to the **Active Edits** tab to view a paginated grid of all active road closures and speed adjustments, filter by region or search query, jump to the segment on the Live Map, or revert overrides.
