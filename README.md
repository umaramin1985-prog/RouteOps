# RouteOps 🚗 🗺️

RouteOps is a powerful, full-stack transportation management system built around the **Open Source Routing Machine (OSRM)**. It provides a sleek, dark-mode web dashboard to deploy routing engines for specific US states on-the-fly, calculate routes (Car & Foot), and instantly apply dynamic road closures with **zero-downtime hot-swapping**.

## 🌟 Features

*   **One-Click Deployment:** Automatically download map data (OSM `.pbf` from Geofabrik) for any US state and spin up dedicated Docker containers.
*   **Zero-Downtime Hot-Swapping:** Close roads directly from the map UI. The backend uses `osrm-customize` and `osrm-datastore` via Shared Memory to instantly patch the routing engine in real-time without taking the server offline.
*   **Active Route Edits Management:** Monitor and manage thousands of hot-swapped road closures and speed adjustments in a dedicated, paginated grid with real-time search filtering.
*   **Multi-Profile Routing:** Seamlessly switch between Car (driving) and Foot (walking) routing profiles.
*   **Advanced Navigation & Debugging:** Avoid tolls, calculate alternative routes, view detailed turn-by-turn navigation instructions, and inspect raw, unformatted JSON API responses directly from the OSRM backend.
*   **Beautiful UI:** A modern, glassy, fully responsive React interface built for command centers, structured across dedicated tabs (Engines Setup, Live Map, and Active Edits).

## 🏗️ Architecture

*   **Frontend:** React (Vite), TypeScript, Leaflet (Map rendering)
*   **Backend:** Python (FastAPI), SQLAlchemy (SQLite), Docker SDK
*   **Engine:** OSRM (Open Source Routing Machine) running via Docker

## 🚀 Prerequisites

To run this project, you must have the following installed on your machine:
*   **Docker:** (Docker Desktop on Windows, or native Docker engine on Linux)
*   **Python 3.10+**
*   **Node.js (v16+)**

*(Note: Running this project natively on a Linux machine is highly recommended over Windows WSL2, as compiling OSRM graph data is extremely CPU and I/O intensive.)*

## 🛠️ Installation & Setup

### Automated Setup (Recommended)
We provide automated, zero-touch setup scripts tailored for different operating systems. These scripts will automatically check for and install missing prerequisites (Docker, Python, Node.js), verify port availability, fetch the latest dependencies, and launch the entire application.

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

*(Note: If you already have all prerequisites installed, you can also simply run `python install.py` directly).*

These scripts will:
1. Install any missing system dependencies (Docker, Node.js, Python, Unzip).
2. Install Python backend and Node.js frontend dependencies (pulling the latest compatible versions).
3. Verify required ports and interactively prompt you to change OSRM ports if they are blocked (automatically updating the codebase).
4. Download the default map data (Maryland).
5. Start the frontend, backend, database, and OSRM engine containers via `docker-compose`.

### Production Deployment
The default setup runs the application in development mode (with hot-reloading). To run the application in a highly optimized production environment using NGINX, simply run:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```

Once complete, access the portal at:
*   **Frontend UI:** `http://localhost:5173/dashboard`
*   **Backend API:** `http://localhost:8000`

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

1.  **Deploy an Engine:** Go to the **Engines Setup** tab on the top navigation bar. Select a state from the dropdown (e.g., Mississippi) and click deploy. The backend will download the map data, compile it, and start the Docker containers.
2.  **Calculate a Route:** Go to the **Live Map** tab. Click anywhere on the map to set a Start point, and click again to set a Destination. The route will be drawn instantly. You can click the **JSON** button in the route summary to view and copy the raw API request and response.
3.  **Close a Road:** Once a route is drawn, you can click directly on the blue route line to adjust its speed limit or completely close the road. The change will instantly propagate to the routing engine.
4.  **Manage Active Edits:** Navigate to the **Active Edits** tab to view a complete, paginated grid of all active road closures and speed adjustments. You can search by node ID or reason, and quickly remove any edits to instantly restore the original map state.
