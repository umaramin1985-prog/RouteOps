# RouteOps / GeoOps v2.4.0 - Comprehensive Project Context

> **Project Name:** RouteOps (frontend branding: **GeoOps**)  
> **Repository:** `umaramin1985-prog/RouteOps`  
> **Current Version:** `2.4.0`  
> **Architecture:** Full-stack microservices (FastAPI backend + React/Vite frontend + OSRM routing engines + Nominatim & Pelias geocoders + PostgreSQL/PostGIS / SQLite database + Docker SDK)

---

## 1. Executive Summary & Purpose

**RouteOps** is an enterprise-grade transportation management and routing operations platform engineered around the **Open Source Routing Machine (OSRM)**, complemented by **Nominatim** and **Pelias** geocoding engines.

The platform provides a modern command-center interface to:
1. **Deploy and Manage Routing Engines on Demand:** Select any US state (or combination of states), download raw OpenStreetMap (`.osm.pbf`) data directly from Geofabrik, merge graphs using `osmium-tool`, and compile Multi-Level Dijkstra (MLD) routing graphs for both Driving (`car`) and Walking (`foot`) profiles inside isolated Docker containers.
2. **Execute Zero-Downtime Map Updates:** Add or remove state maps on-the-fly. The backend compiles the new graph in the background and dynamically swaps it into running containers via shared memory (`/dev/shm` and `osrm-datastore`) without dropping in-flight navigation requests.
3. **Perform Zero-Downtime Hot-Swapping Road Overrides:** Click any road segment on the live map to enforce custom speed limits or full road closures. Changes are instantly injected into the routing graph via `osrm-customize` and `osrm-datastore` without restarting containers.
4. **Inspect & Manage Road Overrides:** The **Active Edits** tab provides a paginated, searchable grid of all active road closures and speed adjustments, with geographic coordinate filtering, road/city metadata, and one-click removal.
5. **Interactive Live Navigation:** Multi-stop waypoints (up to 8 intermediate stops), turn-by-turn navigation instructions with maneuver icons, toll avoidance filtering, alternative route calculations, GPS tracking ("Locate Me"), satellite tile switching, and raw JSON request/response inspection.
6. **Strictly Self-Hosted Local Geocoding & Address Autocomplete:** Integrated address search, POI discovery, and reverse geocoding powered strictly and exclusively by installed local **Pelias** and **Nominatim** Docker services. All third-party external public web fallbacks (Photon, OSM public Nominatim, BigDataCloud) are completely disabled for 100% self-hosted privacy, offline reliability, and air-gapped compliance.
7. **Real-Time Telemetry & Operations Command:** Live CPU, RAM, Disk I/O, Network throughput charts (`recharts`), container health checks, API hit counters, latency tracking, Docker container log streaming, and an embedded Docker terminal.

---

## 2. System Architecture & Topology

```
                                  +------------------------------------------------+
                                  |                 Client Browser                 |
                                  |    (React 19 + TypeScript + Leaflet + Vite)    |
                                  +-----------------------+------------------------+
                                                          |
                                    HTTP :80 (Prod) /     |     HTTP :5001 (Car)
                                    HTTP :5173 (Dev)      |     HTTP :5005 (Foot)
                                                          |     HTTP :5003 (Nominatim)
                                                          v     HTTP :5002 (Pelias)
                          +-------------------------------+--------------------------------+
                          |                   Nginx (Prod) / Vite (Dev)                    |
                          |  Proxies /api/* -> Backend:8000 | Serves SPA bundle on /       |
                          +-------------------------------+--------------------------------+
                                                          |
                                                          v
                                  +------------------------------------------------+
                                  |             RouteOps Backend (FastAPI)         |
                                  |  - REST Endpoints (/overrides, /system/*)      |
                                  |  - Docker SDK Controller via docker.sock       |
                                  |  - Background Tasks (Merge, Build, Customize)  |
                                  |  - Host Telemetry via psutil                   |
                                  +-------+-------------------+--------------------+
                                          |                   |
                     Shared SQLite/PG     |                   | Docker SDK / Socket
                                          v                   v
+-------------------------------------------+   +------------------------------------------------+
|             Database Layer                |   |             Docker Engine Daemon               |
| - SQLite: osrm_portal.db (Local default)  |   |            (/var/run/docker.sock)              |
| - PostgreSQL/PostGIS 15:5433 (Compose)    |   +---------------------+--------------------------+
| - Alembic Schema Migrations               |                         |
+-------------------------------------------+                         |
                                                                      +---> routeops-osrm-car-1 (:5001)
                                                                      |     - osrm-routed --shared-memory
                                                                      |     - osrm-datastore hot-swap
                                                                      |
                                                                      +---> routeops-osrm-foot-1 (:5005)
                                                                      |     - osrm-routed --shared-memory
                                                                      |     - osrm-datastore hot-swap
                                                                      |
                                                                      +---> routeops-nominatim-1 (:5003)
                                                                      |     - mediagis/nominatim:5.3
                                                                      |
                                                                      +---> Pelias Geocoding Stack:
                                                                      |     - routeops-pelias-elasticsearch-1 (:9200)
                                                                      |     - routeops-pelias-1 (:5002 -> :4000)
                                                                      |     - pelias/schema (on build)
                                                                      |     - pelias/openstreetmap (on build)
                                                                      |
                                                                      +---> stefda/osmium-tool (ephemeral merge)
                                                                      |
                                                                      +---> Persistent Volume: /data
                                                                            - speeds.csv, active_states.json, ports.json
                                                                            - deploy.log, api_calls.json, pelias.json
                                                                            - *.osrm*, backup_*
                                                                            - (*.osm.pbf purged post-install)
```

---

## 3. Repository Directory Structure

```
c:\Code\OSRM 2\
├── .gitignore                      # Ignores node_modules, __pycache__, data/, .env, build/
├── LICENSE                         # MIT License
├── README.md                       # High-level project documentation, v2.4.0 release notes
├── docker-compose.yml              # Dev compose: backend (:8000), frontend (:5173), postgis db (:5433)
├── docker-compose.prod.yml         # Production compose: backend (:5172), frontend (:80), postgis db (:5433)
├── docker-compose.geocoding.yml    # Geocoding compose: Nominatim (:5003) + Pelias (ES:9200, API:5002)
├── install.py                      # Interactive fresh install Python runner (port collision resolution)
├── setup-windows.ps1               # Automated installer/updater for Windows (PowerShell)
├── setup-ubuntu.sh                 # Automated installer/updater for Ubuntu / Debian (Bash)
├── setup-centos.sh                 # Automated installer/updater for CentOS / RHEL / Alma (Bash)
├── patch.py                        # Python patch script for backend state-dictionary merge logic
├── patch_main.py                   # Python patch script for Nominatim/Pelias container recreation
├── patch_frontend.py               # Python patch script for per-engine modal tabs in EngineSetup.tsx
├── patch_map.py                    # Python patch script for geocoding tabs and pins in MapDisplay.tsx
├── pelias_test.py                  # Standalone test script for Pelias ES readiness and schema creation
├── test_osm.py                     # Standalone test script for Pelias OSM import execution
│
├── backend/                        # FastAPI Backend Application
│   ├── .dockerignore               # Excludes __pycache__, *.db, test_*.py from Docker build context
│   ├── Dockerfile                  # Python 3.10-slim + docker.io CLI + requirements + layer cleanup
│   ├── requirements.txt            # Python dependencies (fastapi, uvicorn, docker, psutil, alembic...)
│   ├── database.py                 # SQLAlchemy database setup, RoadOverride & User models
│   ├── main.py                     # Main application entry point, REST endpoints, Docker orchestrator
│   ├── state_bounds.json           # US geographic bounding boxes for state regions
│   ├── test_logs.py                # Scratch script testing Docker log clearing via Alpine mount
│   ├── test_logs2.py               # Scratch script inspecting container LogPath sizes
│   ├── test_mount.py               # Scratch script inspecting /var/lib/docker/containers mount
│   ├── alembic.ini                 # Alembic migration configuration
│   └── alembic/                    # Alembic migration scripts
│       ├── env.py                  # Alembic runtime environment connecting to SQLAlchemy models
│       ├── script.py.mako          # Migration template
│       └── versions/
│           └── 4ee414d6b05f_initial_schema.py # Initial migration baseline
│
├── frontend/                       # React / Vite Frontend Application
│   ├── .dockerignore               # Excludes node_modules, dist, *.py from Docker build context
│   ├── package.json                # React 19, Vite 8, react-leaflet 5, recharts 3, lucide-react
│   ├── tsconfig.json               # Root TypeScript configuration
│   ├── tsconfig.app.json           # Application TypeScript configuration
│   ├── tsconfig.node.json          # Node/Vite TypeScript configuration
│   ├── vite.config.ts              # Vite configuration with React plugin
│   ├── nginx.conf                  # Production Nginx reverse proxy configuration
│   ├── Dockerfile                  # Dev frontend Dockerfile
│   ├── Dockerfile.prod             # Production multi-stage build Dockerfile (Vite build -> Nginx)
│   ├── index.html                  # HTML entry point with viewport and Inter font
│   ├── update_guest.py             # Script to inject guest role permission guards across components
│   ├── update_guest_exact.py       # Refined guest role injection helper
│   ├── public/                     # Static assets (favicons, background images)
│   │   ├── favicon.svg             # Application logo
│   │   ├── icons.svg               # SVG icons
│   │   ├── login-bg.jpg            # Login background image
│   │   ├── minimal-bg.jpg          # Dark theme background
│   │   └── minimal-bg-light.jpg    # Light theme background
│   └── src/
│       ├── main.tsx                # React DOM root entry point
│       ├── App.tsx                 # App router, theme initialization, ProtectedRoute
│       ├── App.css                 # Base application animations and keyframes
│       ├── index.css               # Core CSS design system: dark/light theme variables, glassmorphism
│       ├── stateBounds.json        # Detailed coordinate bounds for all 50 US states
│       ├── us-states.json          # GeoJSON boundaries of all US states for map overlays
│       ├── assets/                 # App icons and hero images
│       ├── utils/
│       │   └── geocoding.ts        # Search & reverse geocoding client, telemetry logging, multi-provider fallbacks
│       └── components/
│           ├── Login.tsx           # Authentication view (admin/guest login, password recovery)
│           ├── Dashboard.tsx       # Top navbar, tab router (#setup, #map, #edits), DB status, theme toggle
│           ├── EngineSetup.tsx     # Engine management, telemetry charts, container logs, terminal, deployment modal
│           ├── MapDisplay.tsx      # Leaflet interactive map, routing, road overrides modal, geocoding
│           └── ActiveEdits.tsx     # Active road overrides grid, state filtering, pagination, deletion
│
└── data/                           # Runtime storage mounted into containers (git-ignored)
    ├── active_states.json          # Currently deployed states per engine profile
    ├── ports.json                  # Persisted custom host port bindings per engine profile
    ├── speeds.csv                  # Road speed penalties generated from database for osrm-customize
    ├── deploy.log                  # Live log file streamed to the UI during build/merge/deploy
    ├── api_calls.json              # Buffer of recent API hits for analytics
    ├── pelias.json                 # Pelias configuration generated on deployment
    ├── *.osm.pbf                   # Ephemeral state & merged PBF files (auto-deleted post-install)
    ├── car.osrm* / foot.osrm*      # Compiled OSRM routing graphs
    └── backup_car/ / backup_foot/  # Clean, unpatched OSRM graph backups
```

---

## 4. Backend Deep Dive (`backend/`)

### 4.1 Framework & Core Dependencies
- **FastAPI**: Asynchronous web framework with automatic OpenAPI documentation.
- **Uvicorn**: ASGI server.
- **SQLAlchemy**: ORM for database modeling and query execution.
- **Docker SDK (`docker>=7.0.0`)**: Interacts with the host Docker daemon via `/var/run/docker.sock` to start, stop, monitor, stream logs, and execute commands inside containers.
- **psutil**: Gathers whole-host CPU, RAM, disk usage, disk read/write rates, and network I/O.
- **PyYAML**: Dynamically updates ports in `docker-compose.yml`.
- **Alembic**: Database schema migrations.

### 4.2 Database Models (`backend/database.py`)
- **`RoadOverride`** (`road_overrides` table):
  | Column | Type | Purpose |
  |---|---|---|
  | `id` | `Integer` (PK) | Auto-increment primary key |
  | `from_node` | `String` (Indexed) | Starting OSM node ID (or comma-separated list of nodes) |
  | `to_node` | `String` (Indexed) | Ending OSM node ID |
  | `speed_kmh` | `Float` | Adjusted speed in km/h |
  | `is_closed` | `Boolean` | Flag indicating road is completely closed (`1 km/h` heavy penalty) |
  | `is_bidirectional` | `Boolean` | If true, override applies to both `from->to` and `to->from` |
  | `reason` | `String` (Nullable) | User-entered explanation (e.g. "Construction", "Flooding") |
  | `lat`, `lng` | `Float` (Nullable) | Geographic coordinates of the segment center |
  | `geometry` | `String` (Nullable) | Serialized GeoJSON segment geometry |
  | `road_name` | `String` (Nullable) | Street or highway name (e.g. "Main St") |
  | `city_name` | `String` (Nullable) | City / locality name |
  | `created_at` | `DateTime` | UTC timestamp of when override was created |

- **`User`** (`users` table):
  | Column | Type | Purpose |
  |---|---|---|
  | `id` | `Integer` (PK) | Primary key |
  | `username` | `String` (Unique, Indexed) | Username (Default: `admin`) |
  | `password` | `String` | Password (Default: `admin`) |
  | `recovery_code` | `String` (Nullable) | Reset token (Default: `123456`) |

### 4.3 Database Initialization & Migrations
On startup (`@app.on_event("startup")`):
1. `Base.metadata.create_all(bind=engine)` creates tables if they do not exist.
2. Checks if `alembic_version` exists in the database. If absent, executes `alembic stamp head`.
3. Runs `alembic upgrade head`.
4. Seeds the default `admin` user (`admin` / `admin` / `123456`) if missing.

### 4.4 Complete Backend REST API Reference

#### Authentication
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/auth/login` | Authenticates username & password. |
| `POST` | `/auth/change-password` | Updates password if old password matches. |
| `POST` | `/auth/recover-password` | Resets password using `recovery_code`. |

#### Road Overrides (Hot-Swapping)
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/overrides` | Retrieves all active road overrides from DB. |
| `POST` | `/overrides` | Inserts a new road override and schedules background `rebuild_osrm_data`. |
| `POST` | `/overrides/bulk` | Inserts multiple overrides and schedules background `rebuild_osrm_data`. |
| `DELETE` | `/overrides/{override_id}` | Removes an override and schedules background `rebuild_osrm_data`. |

#### OSRM & Deployment Lifecycle
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/system/merge` | **Fresh Deployment:** Downloads OSM PBFs, merges via `osmium-tool`, compiles graphs (`extract`, `partition`, `customize`), backs up graphs, recreates containers. |
| `POST` | `/system/update` | **Zero-Downtime Update:** Downloads new state PBFs, merges, compiles graphs, and hot-swaps active memory using `osrm-datastore` without restarting containers. |
| `POST` | `/system/deploy` | Rebuilds and launches OSRM containers for given ports. |
| `GET` | `/system/logs` | Reads `/data/deploy.log` line-by-line for live frontend build tracking. |
| `POST` | `/system/bootstrap` | Checks dependencies, Docker connectivity, map files, and container states. |

#### Docker & Telemetry
| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/system/metrics` | Host telemetry: CPU %, RAM %, Disk usage %, Disk read/write rates, Net in/out rates. |
| `GET` | `/system/db-status` | Tests database connectivity with `SELECT 1`. |
| `GET` | `/system/docker` | Container statuses, ports, started timestamps, active states, and log file sizes. |
| `GET` | `/system/docker/{profile}/stats` | Live Docker stats for `car` or `foot` (CPU %, memory usage, I/O). |
| `GET` | `/system/docker/{profile}/logs` | Tail last 50 lines of logs for specified container. |
| `POST` | `/system/docker/{profile}/start` | Starts specified container. |
| `POST` | `/system/docker/{profile}/stop` | Stops specified container. |
| `POST` | `/system/docker/{profile}/clear_logs` | Truncates container JSON log file via ephemeral Alpine mount. |
| `POST` | `/system/docker/nominatim/restart` | Restarts Nominatim container. |
| `POST` | `/system/docker/pelias/install` | Triggers Pelias index recreation and OSM import. |
| `GET` | `/system/docker/nominatim/logs` | Tails last 100 log lines from Nominatim. |
| `GET` | `/system/docker/pelias/logs` | Tails last 100 log lines from Pelias. |
| `POST` | `/system/docker/remove-all` | Stops & removes all RouteOps containers and wipes `/data` (except `speeds.csv`). |
| `POST` | `/system/exec` | Runs sanitized `docker` CLI command and pipes output to `deploy.log`. |

#### API Call Analytics
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/system/api-calls/log` | Logs an API call (used by frontend for geocoding tracking). |
| `GET` | `/system/api-calls` | Aggregates and returns recent API calls parsed from OSRM/Pelias container logs and `/data/api_calls.json`. |

### 4.5 The OSRM Build & Hot-Swap Lifecycle
1. **Speed Penalties Export:** Database entries in `road_overrides` are written to `/data/speeds.csv` format:  
   `<from_node>,<to_node>,<speed_integer>`  
   *(If `is_closed == true`, speed is set to `1` km/h to heavily penalize routing).*
2. **Graph Compilation (MLD Algorithm):**
   - `osrm-extract -p /opt/{profile}.lua /data/{profile}.osm.pbf`
   - `osrm-partition /data/{profile}.osrm`
   - Pristine backup copy saved to `/data/backup_{profile}/`
   - `osrm-customize /data/{profile}.osrm --segment-speed-file /data/speeds.csv`
3. **Execution with Shared Memory:**
   - Container runs `osrm-datastore /data/{profile}.osrm`
   - Spawns `osrm-routed --shared-memory=yes --algorithm mld`
4. **Instant Road Override (No Downtime):**
   - When an edit is added or removed, `rebuild_osrm_data()` rewrites `speeds.csv`.
   - Copies pristine graph from `/data/backup_{profile}/` back to `/data/` (does not require `.osm.pbf` files on disk).
   - Runs `osrm-customize /data/{profile}.osrm --segment-speed-file /data/speeds.csv` inside running container via `container.exec_run()`.
   - Runs `osrm-datastore /data/{profile}.osrm` inside running container to hot-swap shared memory blocks instantly.

### 4.6 Automated Post-Installation Cleanup Lifecycle
1. **Raw State PBF Cleanup (`cleanup_raw_state_pbfs`):**
   - Only downloads state `.osm.pbf` files for the specific engine profiles enabled in the current deployment job.
   - Immediately removes raw `{state}.osm.pbf` files once `osmium-tool` merge or single-state copy into `{profile}.osm.pbf` completes, reclaiming disk space before graph/index compilation begins.
   - Also sweeps `/data` on backend startup (`on_startup()`) and after deployment completion/failure.
2. **Per-Engine Artifact & Container Cleanup (`cleanup_engine_files` & `wait_for_nominatim_and_cleanup`):**
   - **OSRM (`car`, `foot`):** Once the compiled graph is loaded into shared memory (`osrm-datastore`), deletes `/data/car.osm.pbf` and `/data/foot.osm.pbf`, cleans `/tmp/*` and `/var/tmp/*` inside `routeops-osrm-car-1` / `routeops-osrm-foot-1`, and prunes exited build containers.
   - **Nominatim (`nominatim`):** Monitors the PostgreSQL import inside `routeops-nominatim-1` until `/var/lib/postgresql/*/main/initialized` is created, then removes `/data/nominatim.osm.pbf` on the host and `/nominatim/data.osm.pbf`, `/nominatim/*.pbf`, `/tmp/*`, `/var/tmp/*`, and `/var/lib/apt/lists/*` inside the container.
   - **Pelias (`pelias`):** Once `pelias/schema` and `pelias/openstreetmap` complete indexing into Elasticsearch, removes `/data/pelias.osm.pbf` and cleans `/tmp/*`, `/var/tmp/*`, `/root/.npm`, and `/root/.cache` inside `routeops-pelias-1` and `routeops-pelias-elasticsearch-1`.
   - **Docker Daemon Pruning:** Executes `client.containers.prune()` and `client.images.prune(filters={'dangling': True})` after each engine installation.

---

## 5. Frontend Deep Dive (`frontend/`)

### 5.1 Architecture & Libraries
- **Framework:** React 19 + TypeScript + Vite 8.
- **Routing:** React Router v7 (`react-router-dom`).
- **Mapping:** Leaflet 1.9.4 and `react-leaflet` 5.0.0.
- **Charts:** `recharts` 3.10.1 (smooth AreaCharts with gradient fills).
- **Icons:** `lucide-react`.
- **CSS Architecture:** Vanilla CSS design system (`index.css`) utilizing CSS custom properties for instant light/dark theme transitions, custom scrollbars, and glassmorphism panels.

### 5.2 Roles & Permissions
- **Admin:** Full access to configure engines, deploy maps, execute terminal commands, apply road overrides, and delete active edits.
- **Guest:** Read-only access. The UI automatically disables:
  - Deploy / Update buttons in `EngineSetup.tsx`
  - Container Start / Stop / Clear Logs actions
  - Road speed limit and road closure submission in `MapDisplay.tsx`
  - Road override deletion buttons in `ActiveEdits.tsx`

### 5.3 Detailed Component Architecture

#### 1. `Login.tsx`
- Dual-mode card: Sign In and Forgot Password / Account Recovery.
- Includes quick **Guest Login** button (`role: 'guest'`).
- Displays application version dynamically from `package.json`.

#### 2. `Dashboard.tsx`
- Top header with GeoOps branding, PostgreSQL/DB live status indicator, light/dark theme switcher, change password modal, and logout.
- Hash-based tab navigation: `#setup` (Engines Setup), `#map` (Live Map), `#edits` (Active Edits).
- Blocks navigation to Live Map while a background deployment is active (`dockerStatus.is_deploying`).
- Fullscreen mode toggle that expands map/content across 100vw/100vh.

#### 3. `EngineSetup.tsx`
- **4 Engine Cards:**
  - Car Routing Engine (`osrm-car`, default port 5001)
  - Foot Routing Engine (`osrm-foot`, default port 5005)
  - Nominatim Geocoder (`nominatim`, default port 5003)
  - Pelias Search/Autocomplete (`pelias_api`, default port 5002)
- Each card shows: Online/Offline status badge, uptime duration, installed states count (clickable popup to view list), log file size, 24-hour total API hits, service breakdown badges, average/min/max response times, failed request count, peak requests/minute, and last request timestamp.
- **Live System Telemetry Charts:** Real-time graphs for CPU %, RAM %, Disk Read/Write rates, and Network In/Out rates.
- **Console / Terminal Panel:**
  - Multi-tab log viewer: Traffic Log, Deployment Log, Car Logs, Foot Logs, Nominatim Logs, Pelias Logs.
  - Interactive CLI input allowing direct execution of `docker` commands.
  - Fullscreen toggle for terminal view.
- **Engine Configuration Modal:**
  - Multi-tab state selector (`car`, `foot`, `nominatim`, `pelias`) allowing independent state selection per engine.
  - Quick **Select All** and **Deselect All** buttons for multi-state batch configuration.
  - Search filter across all 50 US states.
  - Dual action buttons: "Update States (Zero Downtime)" and "Destroy Existing Containers & Deploy Fresh Setup".

#### 4. `MapDisplay.tsx`
- **Map Viewport:**
  - Leaflet map with custom Google Maps-style markers (green start ring, red destination pin, blue numbered stop badges, red place marker, pulsating blue GPS user location dot).
  - OpenStreetMap standard tiles and Esri World Imagery satellite layer switcher.
  - Active state boundary outlines rendered via GeoJSON from `us-states.json`.
- **Search & Directions Modes:**
  - Search mode: Autocomplete input powered strictly by installed local Pelias or Nominatim (`searchPlaces()`). Features a real-time engine badge (`Pelias` or `Nominatim` with green online / red offline indicator), dynamic placeholder hints, and helpful empty-result notifications.
  - Directions mode: Origin, Destination, and up to 8 Intermediate Stops with local reverse-geocoded waypoint addresses.
  - Profile toggle: Car vs Foot.
  - Preferences: Avoid Tolls, Fastest vs Shortest route, Show Alternatives.
- **Turn-by-Turn Navigation:** Collapsible step-by-step guidance list with maneuver directions (turn left, right, slight, sharp, straight, roundabouts, arrival) and distance/time per leg.
- **Road Override & Closure Tool:**
  - Right-click anywhere on a route polyline to open the Road Override modal.
  - Detects nearest OSM node IDs from OSRM response annotations (`annotations.nodes`).
  - Sets new speed limit (MPH converted to km/h) or marks road completely closed.
  - Configurable directionality (one-way or bidirectional).
  - Reverse geocodes road name and city automatically via active local geocoding engine.
  - Instantly dispatches to backend `POST /overrides`.
- **Raw JSON Debugger:** Inspects and copies exact OSRM API URL, request payload, and raw JSON response.

#### 5. `ActiveEdits.tsx`
- Paginated grid (24 items per page) of all active road closures and speed adjustments.
- State filter dropdown based on geographic bounding box calculations (`stateBounds.json`).
- Search box filtering by reason, street name, city, node ID, or status ("closed" vs "speed").
- Click any edit card to automatically navigate to the Live Map tab (`#map`) and zoom directly into the affected road segment.
- Deletion modal to revert road overrides.

#### 6. `geocoding.ts` (Unified Local Client)
- **Strictly Local Geocoding (`searchPlaces`):**
  1. Local Pelias (`http://localhost:{port}/v1/autocomplete` and `/v1/search`)
  2. Local Nominatim (`http://localhost:{port}/search`)
  - Directs queries strictly to the active engine or running local instance.
  - Returns `[]` without remote calls if no local record matches.
- **Strictly Local Reverse Geocoding (`reverseGeocode`):**
  1. Local Pelias (`/v1/reverse`)
  2. Local Nominatim (`/reverse`)
  - Resolves map clicks, marker drags, and context menu lookups purely from local containers.
  - Falls back cleanly to coordinate string (`lat, lng`) if outside indexed areas.
- **Zero Remote Dependencies:** All third-party public web APIs (Photon, OSM public Nominatim, BigDataCloud) have been eliminated for air-gapped security, zero external data leakage, and predictable offline reliability.
- **Telemetry Hook:** Logs every geocode query, service type, and latency to backend `POST /system/api-calls/log`.

---

## 6. Data Directory Structure (`data/`)

The `./data` directory is mounted into Docker containers as `/data`. It contains all runtime, graph, and log data:

| File / Folder | Description |
|---|---|
| `active_states.json` | JSON dictionary mapping engine profile (`car`, `foot`, `nominatim`, `pelias`) to list of installed state slugs. |
| `ports.json` | Persisted custom host port assignments (`car`, `foot`, `nominatim`, `pelias`). |
| `speeds.csv` | Comma-delimited file containing `<from_node>,<to_node>,<speed>` used by `osrm-customize`. |
| `deploy.log` | Text log tracking current and past deployments, downloads, merge steps, and `[CLEANUP]` events. |
| `api_calls.json` | Rolling buffer of up to 1,000 logged API calls with latencies and timestamps. |
| `pelias.json` | Generated Pelias configuration specifying Elasticsearch host, indices, and OSM import path. |
| `{state}.osm.pbf` | Ephemeral raw state OpenStreetMap PBF files downloaded from Geofabrik (automatically removed after merge). |
| `{profile}.osm.pbf` | Ephemeral merged PBF files (`car.osm.pbf`, `foot.osm.pbf`, `nominatim.osm.pbf`, `pelias.osm.pbf`) used during graph/index build and automatically deleted after installation. |
| `car.osrm*`, `foot.osrm*` | Compiled OSRM MLD graph data files (`.cells`, `.ebg`, `.enw`, `.fileIndex`, `.hs`, `.mldgr`, `.nodes`, `.properties`, `.ramIndex`, `.timestamp`). |
| `backup_car/`, `backup_foot/` | Pristine copies of graph files kept to allow re-applying `speeds.csv` cleanly without `.osm.pbf` files. |

---

## 7. Docker Compose Environments

### 7.1 Development (`docker-compose.yml`)
- Backend mounted from `./backend` to `/app` with auto-reloading (`WATCHFILES_FORCE_POLLING=true`).
- Frontend mounted from `./frontend` to `/app` with polling (`CHOKIDAR_USEPOLLING=true`) on port `5173`.
- PostgreSQL/PostGIS database on port `5433:5432`.
- Host Docker socket mounted at `/var/run/docker.sock`.
- Host `/proc` mounted at `/host_proc:ro` for psutil metrics inside Linux containers.

### 7.2 Production (`docker-compose.prod.yml`)
- Backend runs standalone Dockerfile on port `5172:8000`.
- Frontend multi-stage build: compiles Vite SPA and serves static bundle via Nginx on port `80:80`.
- Nginx proxies `/api/*` requests directly to backend container at `http://backend:8000/`.
- PostgreSQL/PostGIS on port `5433:5432` with persistent `db_data` volume.

### 7.3 Geocoding Stack (`docker-compose.geocoding.yml`)
- **`nominatim`** (`mediagis/nominatim:5.3`): Port `5003:8080`, 2GB shared memory, auto-imports `/data/nominatim.osm.pbf`.
- **`pelias_elasticsearch`** (`pelias/elasticsearch:7.17.15`): Port `9200:9200`, single-node cluster.
- **`pelias_schema`** (`pelias/schema:master`): Ephemeral container to create Elasticsearch index.
- **`pelias_api`** (`pelias/api:master`): Node.js API server on port `5002:4000`.
- **`pelias_osm_importer`** (`pelias/openstreetmap:master`): Imports OSM data into Elasticsearch (`profiles: [tools]`).

---

## 8. Installation & Deployment Procedures

### 8.1 Fresh Install vs Update
The platform provides automated dual-mode scripts:
- **Windows:** `setup-windows.ps1`
- **Ubuntu / Debian:** `setup-ubuntu.sh`
- **CentOS / RHEL / Alma:** `setup-centos.sh`

When run, the scripts prompt:
1. **Option 1 (Fresh Install - Destructive):**
   - Completely tears down all containers, dangling images, and volumes matching `routeops` and `osrm`.
   - Wipes `/data/*` and deletes `backend/osrm_portal.db`.
   - Runs `python install.py`, which checks port availability (`5173`, `5172`, `5433`, `5001`, `5005`), prompts for new ports if busy, launches `docker-compose.prod.yml`, and prunes stopped containers, dangling images, and Docker build caches (`docker container/image/builder prune -f`).
2. **Option 2 (Update Existing Deployment - Safe):**
   - Runs `git pull origin main`.
   - Executes `docker compose -f docker-compose.prod.yml up -d --build`.
   - Runs `docker container prune -f`, `docker image prune -f`, and `docker builder prune -f`.
   - **Preserves all map data, database overrides, and user accounts.**

### 8.2 Default Ports Matrix
| Service | Default Port | Configurable? |
|---|---|---|
| Frontend UI (Production) | `80` | Yes (in `docker-compose.prod.yml`) |
| Frontend UI (Dev) | `5173` | Yes (in `docker-compose.yml`) |
| Backend API (Production) | `5172` (Host) -> `8000` (Container) | Yes |
| Backend API (Dev) | `8000` | Yes |
| PostgreSQL / PostGIS | `5433` (Host) -> `5432` (Container) | Yes |
| OSRM Car Engine | `5001` (Host) -> `5000` (Container) | Yes (via UI & `install.py`) |
| OSRM Foot Engine | `5005` (Host) -> `5000` (Container) | Yes (via UI & `install.py`) |
| Nominatim Geocoding | `5003` (Host) -> `8080` (Container) | Yes (via UI & compose) |
| Pelias API | `5002` (Host) -> `4000` (Container) | Yes (via UI & compose) |
| Pelias Elasticsearch | `9200` | Fixed internal |

### 8.3 Default Credentials
| Attribute | Value |
|---|---|
| Username | `admin` |
| Password | `admin` |
| Recovery Code | `123456` |
| Guest Access | Available via "Guest Login" on sign-in screen (read-only) |

---

## 9. Utility & Patch Scripts Reference

| Script | Purpose |
|---|---|
| `install.py` | Cross-platform Python installer with socket-based port availability checks and automatic file patching. |
| `patch.py` | Modifies `process_merge` and `process_update` in `backend/main.py` to support per-engine dictionary state structures. |
| `patch_main.py` | Updates Nominatim and Pelias container recreation routines to bind dynamic host ports. |
| `patch_frontend.py` | Injects per-engine modal tabs (`car`, `foot`, `nominatim`, `pelias`) into `EngineSetup.tsx`. |
| `patch_map.py` | Injects geocoding tabs, search input, and result pins into `MapDisplay.tsx`. |
| `pelias_test.py` | Standalone diagnostics script testing Elasticsearch readiness and Pelias schema creation. |
| `test_osm.py` | Standalone script testing the `pelias/openstreetmap` importer. |
| `frontend/update_guest.py` | Audits and injects `role === "guest"` disabled guards on mutative buttons. |
| `backend/test_logs.py` | Verifies container log clearing via Alpine volume mounting. |
| `backend/test_mount.py` | Tests read access to `/var/lib/docker/containers`. |

---

## 10. Operational Considerations & Best Practices

1. **Hardware & Resource Requirements:**
   - Extracting and partitioning large US states (e.g., California, Texas, New York) is CPU and memory intensive.
   - Compiling multi-state regions requires at least **8 GB to 16 GB of RAM**.
   - Running natively on Linux is significantly faster than Windows WSL2 due to disk I/O throughput.
2. **Shared Memory (`shm_size` / `/dev/shm`):**
   - OSRM uses shared memory (`osrm-datastore`) for zero-downtime routing. Containers are launched with `ipc_mode="shareable"`.
   - Nominatim requires `shm_size: 2g` to avoid PostgreSQL shared memory exhaustion during indexing.
3. **Log Rotation & File Sizes:**
   - Long-running OSRM and geocoding containers produce high volumes of request logs.
   - The UI provides **Clear Logs** buttons which mount the container's log file into an ephemeral Alpine container and truncate it (`cat /dev/null > /host_log`) without terminating the container.
4. **Database Safety & Head Stamping:**
   - When deploying on a fresh environment, Alembic automatically runs `alembic stamp head` followed by `alembic upgrade head` in `on_startup()`, preventing version collision errors.

---

## 11. Release History & Changelog

### v2.4.0 (Current)
- **Strictly Local Geocoding & Reverse Geocoding:**
  - Forward search (`searchPlaces`) and reverse geocoding (`reverseGeocode`) on the Live Map now strictly query installed local **Pelias** (`routeops-pelias-1` / port 5002) or **Nominatim** (`routeops-nominatim-1` / port 5003).
  - Completely purged all third-party external public web fallbacks (Photon Komoot, OpenStreetMap public Nominatim, BigDataCloud) for full air-gapped compliance, self-hosted privacy, and offline stability.
  - Replaced fallback mechanisms with raw coordinates (`lat, lng`) for points outside indexed boundaries.
- **Live Map Geocoder Status & Indicators:**
  - Added real-time badge in the Live Map search bar indicating the active local geocoding engine (`Pelias` or `Nominatim`) with live connectivity status (green online / red offline).
  - Added helpful empty-state feedback in the search dropdown notifying users when queries yield no results in the installed local index.
- **Pelias Deployment Log Visualizer Fix:**
  - Resolved a false-positive styling bug in `EngineSetup.tsx` where normal OpenStreetMap indexing logs reporting `failed_records=0` turned the entire log console red.
  - Added granular console highlighting with emerald green (`#10b981`) for completions and amber (`#f59e0b`) for warnings.
- **Select / Deselect All States:**
  - Added batch "Select All" and "Deselect All" options in the Engine Setup modal for rapid multi-state provisioning.
- **Port Configuration Persistence & Port Standardization:**
  - Fixed an issue where custom-configured ports for routing and geocoding engines were reverting to default values upon saving or container reload.
  - Standardized default geocoder host ports to avoid system collisions: **Pelias** is now mapped to default port `5002` (was `4000`), and **Nominatim** is now mapped to default port `5003` (was `8080`). Updated all compose files, status reporters, and client query routines.
- **Automated Post-Installation Cleanup Across All Docker Engines:**
  - Automatically removes raw state `.osm.pbf` files post-merge and removes merged engine PBF files (`car.osm.pbf`, `foot.osm.pbf`, `nominatim.osm.pbf`, `pelias.osm.pbf`) after each engine finishes compiling or indexing.
  - Cleans internal container staging files and caches (`/nominatim/data.osm.pbf`, `/tmp/*`, `/var/tmp/*`, `/root/.npm`, `/var/lib/apt/lists/*`) and prunes exited build containers and dangling Docker images/builder caches.
  - Added `.dockerignore` files and multi-stage layer cleanup to `backend/Dockerfile`, `frontend/Dockerfile`, and `frontend/Dockerfile.prod`.

### v2.3.0
- **Deployment Safety & Stability:** Global error boundaries in background deployment tasks to gracefully abort, clean up partial states, and unlock the UI on download/merge failures.
- **Setup Script Aggressive Cleanup:** `Fresh Install` across setup scripts prunes orphaned containers, dangling images, and volumes.
- **UI & UX Polish:** Removed double-scrollbars in modals, resolved phantom map boundaries, and prevented startup logs from prematurely disabling deployment controls.
