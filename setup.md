# Setup Guide - Map Pathfinding Visualizer

This guide explains how to set up and run the frontend React visualizer and configure a local, offline Overpass API server loaded with the **Karnataka, India** road network.

---

## 1. Frontend Setup

### Prerequisites
- **Node.js**: Version 18 or higher is recommended.
- **npm**: (Package manager included with Node.js).

### Step 1: Install Dependencies
Open a terminal in the root of the project directory and run:
```bash
npm install
```

### Step 2: Start the Development Server
Run the local Vite development server:
```bash
npm run dev
```
Once started, open [http://localhost:5173](http://localhost:5173) in your browser.

---

## 2. Local Overpass API Setup (Docker)

To bypass public API rate limits (HTTP 429) and timeout errors (HTTP 504), you can run a local Overpass database. Setting it up specifically for **Karnataka, India** takes under 5 minutes and uses only ~1.5GB of disk space.

### Prerequisites
- **Docker Desktop**: Download and run [Docker Desktop](https://www.docker.com/products/docker-desktop/). Ensure the Docker engine is running (green status bar icon).
- **Disk Space**: At least **3GB to 5GB of free space** on your drive.

---

### Step 1: Download Karnataka OSM Data
We will download a pre-cut road extract for Karnataka State from the OpenStreetMap French community mirror.

1. Open PowerShell and create a directory for the database:
   ```powershell
   New-Item -ItemType Directory -Force "overpass_db"
   ```
2. Download the Karnataka map data (approx. 120MB):
   ```powershell
   curl.exe -L -o overpass_db\planet.osm.pbf https://download.openstreetmap.fr/extracts/asia/india/karnataka-latest.osm.pbf
   ```

---

### Step 2: Run the Docker Container
Run the following command in PowerShell to launch the container. This imports the local Karnataka data, indexes it without metadata (to save space and RAM), and starts the web server:

```powershell
docker run -d `
  --name overpass `
  -e OVERPASS_MODE=init `
  -e OVERPASS_STOP_AFTER_INIT=false `
  -e OVERPASS_PLANET_URL=file:///db/planet.osm.pbf `
  -e OVERPASS_PLANET_PREPROCESS="mv /db/planet.osm.bz2 /db/planet.osm.pbf && osmium cat -o /db/planet.osm.bz2 /db/planet.osm.pbf && rm /db/planet.osm.pbf" `
  -e OVERPASS_META=no `
  -v "${PWD}\overpass_db:/db" `
  -p 80:80 `
  wiktorn/overpass-api
```

---

### Step 3: Monitor Database Indexing
The container will take **2 to 3 minutes** to index the road network. You can watch the progress using the logs:
```powershell
docker logs -f overpass
```
The database is ready once you see **`Reorganizing the database ... done`** or **`web server started`** at the bottom of the logs.

---

### Step 4: Configure Frontend to use Local Server
1. Open [src/api.js](file:///d:/Agents/Map-Pathfinding-Visualizer/src/api.js).
2. Ensure the local endpoint `"http://localhost/api/interpreter"` is listed at the top of the `OVERPASS_ENDPOINTS` array:
   ```javascript
   const OVERPASS_ENDPOINTS = [
       "http://localhost/api/interpreter",
       "https://overpass-api.de/api/interpreter",
       ...
   ];
   ```

The visualizer will now automatically fetch local Karnataka map data in **under 100ms**! If the local container is stopped, it will automatically fall back to the public mirrors.

---

## 3. Operations & Housekeeping

- **Stop Local Server**: `docker stop overpass`
- **Restart Local Server**: `docker start overpass`
- **Uninstall / Reclaim Space**:
  1. Stop and delete the container: `docker stop overpass; docker rm overpass`
  2. Prune unused Docker cache: `docker system prune -a --volumes -f`
  3. Delete the local directory: `Remove-Item -Recurse -Force overpass_db`
