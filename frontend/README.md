# GeoOps Frontend (RouteOps v2.4.0)

React 19 + TypeScript + Vite 8 + Leaflet web dashboard for **RouteOps / GeoOps**, providing real-time routing engine orchestration, zero-downtime map updates, dynamic road closures, telemetry monitoring, and strictly self-hosted local geocoding.

## Key Components

- **[`src/components/Dashboard.tsx`](src/components/Dashboard.tsx):** Main shell with top navigation bar (`#setup`, `#map`, `#edits`), database connectivity status, light/dark theme toggle, and fullscreen mode.
- **[`src/components/EngineSetup.tsx`](src/components/EngineSetup.tsx):** Manages the 4 Docker engines (`OSRM Car`, `OSRM Foot`, `Nominatim`, `Pelias`), per-engine state provisioning (with Select/Deselect All), custom port bindings, live system telemetry (`recharts`), container logs, and post-installation `[CLEANUP]` tracking.
- **[`src/components/MapDisplay.tsx`](src/components/MapDisplay.tsx):** Interactive Leaflet map with multi-stop routing, turn-by-turn navigation, active local geocoder status indicator (`Pelias` / `Nominatim`), right-click road speed/closure overrides, and raw OSRM JSON inspection.
- **[`src/components/ActiveEdits.tsx`](src/components/ActiveEdits.tsx):** Paginated, searchable grid of active road closures and speed overrides with state bounding-box filtering and one-click map zoom/revert.
- **[`src/utils/geocoding.ts`](src/utils/geocoding.ts):** Strictly local forward (`searchPlaces`) and reverse (`reverseGeocode`) geocoding client querying self-hosted Pelias (`:5002`) and Nominatim (`:5003`) instances with zero external third-party web requests.

## Development & Build

```bash
# Install dependencies
npm install

# Start Vite development server (http://localhost:5173)
npm run dev

# Build production bundle to dist/
npm run build
```

## Docker Build

- **Development ([`Dockerfile`](Dockerfile)):** Node 22 Alpine container running Vite dev server with npm cache and temp file cleanup.
- **Production ([`Dockerfile.prod`](Dockerfile.prod)):** Multi-stage build compiling the static SPA in Node 22 Alpine (cleaning `node_modules` and caches post-build) and serving via `nginx:alpine` on port `80`.
- **Build Context ([`.dockerignore`](.dockerignore)):** Excludes `node_modules/`, `dist/`, `.env`, `*.log`, and helper `.py` scripts.
