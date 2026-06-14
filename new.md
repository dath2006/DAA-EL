Great point — right now the animation is just "here's the final route, watch it draw." There's no *story* being told. Let me look at the current flow more carefully before designing the step-wise visualization.Now I have the full picture. Let me design the step-wise visualization properly.Good. Now I have everything I need. Let me design the complete step-wise visualization system.

The core problem: right now `startClusteredAnimation` dumps the entire final route as one blob of waypoints and plays it. There's no concept of *phases*. Here's what the visualization should actually tell as a story:

**Phase 1 — K-Means clustering** (animated centroid convergence, stops snapping to zones)
**Phase 2 — TSP within each zone** (show the 2-opt solving, path drawing per cluster)
**Phase 3 — Zone sequencing** (connector paths linking zones, depot → zone 1 → zone 2 → depot)
**Phase 4 — Summary** (final route highlighted, stats revealed)

Let me first show the architecture diagram, then give all the code.Now here are all the changes, file by file:

---

## `RoutingService.js` — Add `solveClusteredTspStepwise()`

Add this new function at the bottom. It returns a `phases` array instead of a flat route, which the animation engine will consume phase by phase.

```js
/**
 * Same pipeline as solveClusteredTsp but returns intermediate phases
 * so the visualizer can animate each stage separately.
 *
 * Returns:
 * {
 *   phases: [
 *     { type: 'clustering', frames: [{centroids, assignments}] },   // Phase 1
 *     { type: 'intrazone',  zones: [{clusterId, segments, color}] }, // Phase 2
 *     { type: 'linking',    segments: [{...connector paths}] },      // Phase 3
 *     { type: 'summary',    stats }                                   // Phase 4
 *   ],
 *   finalResult: { ...same shape as solveClusteredTsp }
 * }
 */
export function solveClusteredTspStepwise(depot, stops, k, graph) {
    if (!depot || stops.length === 0 || !graph) return null;

    // ── Phase 1: K-Means with captured frames ──────────────────────────────
    const clusteringFrames = [];

    const actualK = Math.max(1, Math.min(stops.length, k));
    const centroids = [];
    const firstIdx = Math.floor(Math.random() * stops.length);
    centroids.push({ lat: stops[firstIdx].lat, lon: stops[firstIdx].lon });

    for (let c = 1; c < actualK; c++) {
        const distSq = stops.map(stop => {
            let minDist = Infinity;
            for (const centroid of centroids) {
                const d = Math.pow(stop.lat - centroid.lat, 2) + Math.pow(stop.lon - centroid.lon, 2);
                if (d < minDist) minDist = d;
            }
            return minDist;
        });
        const sumDist = distSq.reduce((s, d) => s + d, 0);
        let r = Math.random() * sumDist, cumulative = 0;
        let nextCentroid = stops[stops.length - 1];
        for (let i = 0; i < stops.length; i++) {
            cumulative += distSq[i];
            if (r <= cumulative) { nextCentroid = stops[i]; break; }
        }
        centroids.push({ lat: nextCentroid.lat, lon: nextCentroid.lon });
    }

    let assignments = new Array(stops.length).fill(-1);
    let converged = false, iterations = 0;

    // Capture initial state
    clusteringFrames.push({
        centroids: centroids.map(c => ({ ...c })),
        assignments: [...assignments]
    });

    while (!converged && iterations < 100) {
        converged = true;
        iterations++;

        for (let i = 0; i < stops.length; i++) {
            let minDist = Infinity, nearestIdx = -1;
            for (let cIdx = 0; cIdx < actualK; cIdx++) {
                const d = Math.pow(stops[i].lat - centroids[cIdx].lat, 2)
                        + Math.pow(stops[i].lon - centroids[cIdx].lon, 2);
                if (d < minDist) { minDist = d; nearestIdx = cIdx; }
            }
            if (assignments[i] !== nearestIdx) { assignments[i] = nearestIdx; converged = false; }
        }

        if (!converged) {
            const sumCoords = Array.from({ length: actualK }, () => ({ sumLat: 0, sumLon: 0, count: 0 }));
            for (let i = 0; i < stops.length; i++) {
                sumCoords[assignments[i]].sumLat += stops[i].lat;
                sumCoords[assignments[i]].sumLon += stops[i].lon;
                sumCoords[assignments[i]].count++;
            }
            for (let cIdx = 0; cIdx < actualK; cIdx++) {
                const sc = sumCoords[cIdx];
                if (sc.count > 0) centroids[cIdx] = { lat: sc.sumLat / sc.count, lon: sc.sumLon / sc.count };
            }
        }

        // Capture this iteration's state
        clusteringFrames.push({
            centroids: centroids.map(c => ({ ...c })),
            assignments: [...assignments]
        });
    }

    // Build cluster objects
    const clusters = Array.from({ length: actualK }, (_, idx) => ({ id: idx, centroid: centroids[idx], stops: [] }));
    for (let i = 0; i < stops.length; i++) {
        if (assignments[i] !== -1) clusters[assignments[i]].stops.push({ ...stops[i], clusterId: assignments[i] });
    }
    const activeClusters = clusters.filter(c => c.stops.length > 0);

    // ── Phase 2: Intra-zone TSP with step captures ─────────────────────────
    const ZONE_COLORS = {
        0: [0, 150, 136], 1: [255, 111, 0], 2: [255, 193, 7],
        3: [156, 39, 176], 4: [233, 30, 99], 5: [76, 175, 80],
        6: [33, 150, 243], 7: [255, 87, 34]
    };

    const clusterTours = [];
    const intrazoneSegments = []; // { clusterId, color, steps: [{type:'nn'|'2opt', path}] }

    for (const cluster of activeClusters) {
        const m = cluster.stops.length;
        const color = ZONE_COLORS[cluster.id] || [255, 255, 255];

        // Map to graph nodes
        const stopNodes = cluster.stops.map(stop => {
            let nearestNode = null, minDist = Infinity;
            for (const node of graph.nodes.values()) {
                const d = Math.pow(node.latitude - stop.lat, 2) + Math.pow(node.longitude - stop.lon, 2);
                if (d < minDist) { minDist = d; nearestNode = node; }
            }
            return nearestNode;
        });

        // Distance + path matrices
        const distMatrix = Array.from({ length: m }, () => new Array(m).fill(0));
        const pathMatrix = Array.from({ length: m }, () => new Array(m).fill(null));
        for (let i = 0; i < m; i++) {
            for (let j = i + 1; j < m; j++) {
                const pathResult = findShortestPathSync(stopNodes[i], stopNodes[j], graph);
                if (pathResult) {
                    distMatrix[i][j] = pathResult.distance;
                    distMatrix[j][i] = pathResult.distance;
                    pathMatrix[i][j] = pathResult.path;
                    pathMatrix[j][i] = [...pathResult.path].reverse();
                } else {
                    const d = getDistanceInKm(cluster.stops[i].lat, cluster.stops[i].lon, cluster.stops[j].lat, cluster.stops[j].lon);
                    distMatrix[i][j] = distMatrix[j][i] = d;
                }
            }
        }

        // NN tour
        const nnTour = [0];
        const visited = new Set([0]);
        let current = 0;
        while (nnTour.length < m) {
            let nextNode = -1, minDist = Infinity;
            for (let i = 0; i < m; i++) {
                if (!visited.has(i) && distMatrix[current][i] < minDist) {
                    minDist = distMatrix[current][i]; nextNode = i;
                }
            }
            nnTour.push(nextNode); visited.add(nextNode); current = nextNode;
        }

        // Build NN path segments for animation
        const nnPathSegments = [];
        for (let i = 0; i < m - 1; i++) {
            const p = pathMatrix[nnTour[i]][nnTour[i + 1]] || [stopNodes[nnTour[i]], stopNodes[nnTour[i + 1]]];
            nnPathSegments.push({ path: p, label: `NN: stop ${i + 1} → ${i + 2}` });
        }
        // Close loop
        if (m > 1) {
            const p = pathMatrix[nnTour[m - 1]][nnTour[0]] || [stopNodes[nnTour[m - 1]], stopNodes[nnTour[0]]];
            nnPathSegments.push({ path: p, label: `NN: closing loop` });
        }

        // 2-opt improvements — capture each swap
        const tour = [...nnTour];
        const twoOptSwaps = [];
        let improved = true;
        let iteration = 0;
        while (improved && iteration < 500) {
            improved = false; iteration++;
            for (let i = 1; i < m - 1; i++) {
                for (let j = i + 1; j < m; j++) {
                    const a = tour[i - 1], b = tour[i], c = tour[j], d = tour[(j + 1) % m];
                    const oldDist = distMatrix[a][b] + distMatrix[c][d];
                    const newDist = distMatrix[a][c] + distMatrix[b][d];
                    if (newDist < oldDist - 1e-9) {
                        reverseSubArray(tour, i, j);
                        improved = true;
                        // Capture the improved tour as a sequence of path segments
                        const swapSegments = [];
                        for (let k = 0; k < m - 1; k++) {
                            const p = pathMatrix[tour[k]][tour[k + 1]] || [stopNodes[tour[k]], stopNodes[tour[k + 1]]];
                            swapSegments.push({ path: p });
                        }
                        const closeP = pathMatrix[tour[m - 1]][tour[0]] || [stopNodes[tour[m - 1]], stopNodes[tour[0]]];
                        swapSegments.push({ path: closeP });
                        twoOptSwaps.push({ segments: swapSegments, improvement: oldDist - newDist });
                    }
                }
            }
        }

        intrazoneSegments.push({
            clusterId: cluster.id,
            color,
            nnSegments: nnPathSegments,
            twoOptSwaps, // can be empty if no improvement found
            finalTour: tour,
            finalSegments: tour.map((idx, i) => {
                const nextIdx = tour[(i + 1) % m];
                return pathMatrix[idx][nextIdx] || [stopNodes[idx], stopNodes[nextIdx]];
            })
        });

        clusterTours.push({ clusterId: cluster.id, stops: tour.map(i => cluster.stops[i]), nodes: tour.map(i => stopNodes[i]), distMatrix, pathMatrix });
    }

    // ── Phase 3: Zone linking ──────────────────────────────────────────────
    const sequencedClusters = sequenceZones(depot, activeClusters);
    let depotNode = null, minDepotDist = Infinity;
    for (const node of graph.nodes.values()) {
        const d = Math.pow(node.latitude - depot.lat, 2) + Math.pow(node.longitude - depot.lon, 2);
        if (d < minDepotDist) { minDepotDist = d; depotNode = node; }
    }

    const linkingSegments = [];
    let currentExitNode = depotNode;
    let currentExitCoord = { lat: depot.lat, lon: depot.lon };

    for (let cIdx = 0; cIdx < sequencedClusters.length; cIdx++) {
        const activeCluster = sequencedClusters[cIdx];
        const tour = clusterTours.find(t => t.clusterId === activeCluster.id);
        const m = tour.stops.length;

        // Entry stop closest to current exit
        let entryIdx = 0, minEntryDist = Infinity;
        for (let i = 0; i < m; i++) {
            const d = getDistanceInKm(currentExitCoord.lat, currentExitCoord.lon, tour.stops[i].lat, tour.stops[i].lon);
            if (d < minEntryDist) { minEntryDist = d; entryIdx = i; }
        }

        const entryNode = tour.nodes[entryIdx];
        const connPath = findShortestPathSync(currentExitNode, entryNode, graph);
        linkingSegments.push({
            type: 'connector',
            label: cIdx === 0 ? `Depot → Zone ${activeCluster.id}` : `Zone ${sequencedClusters[cIdx - 1].id} → Zone ${activeCluster.id}`,
            path: connPath ? connPath.path : [currentExitNode, entryNode],
            distance: connPath ? connPath.distance : 0,
            fromZone: cIdx === 0 ? 'depot' : sequencedClusters[cIdx - 1].id,
            toZone: activeCluster.id
        });

        const lastIdx = tour.nodes.length - 1;
        currentExitNode = tour.nodes[lastIdx];
        currentExitCoord = tour.stops[lastIdx];
    }

    // Return to depot
    const returnPath = findShortestPathSync(currentExitNode, depotNode, graph);
    linkingSegments.push({
        type: 'return',
        label: 'Return to depot',
        path: returnPath ? returnPath.path : [currentExitNode, depotNode],
        distance: returnPath ? returnPath.distance : 0,
    });

    // ── Re-use original solver for the final result + stats ────────────────
    const finalResult = solveClusteredTsp(depot, stops, k, graph);

    return {
        phases: [
            { type: 'clustering', frames: clusteringFrames, stops, k: actualK },
            { type: 'intrazone',  zones: intrazoneSegments },
            { type: 'linking',    segments: linkingSegments },
            { type: 'summary',    stats: finalResult?.stats ?? null }
        ],
        finalResult
    };
}
```

---

## `Map.jsx` — Replace the clustered animation system

**1. New imports** — add at top alongside existing imports:
```jsx
import { solveClusteredTsp, solveClusteredTspStepwise } from "../services/RoutingService";
```

**2. Replace all CTSP-related state** with this block (remove the old `tripsData`, keep the non-CTSP ones):
```jsx
// CTSP Routing states
const [routingMode, setRoutingMode] = useState("single");
const [deliveryStops, setDeliveryStops] = useState([]);
const [k, setK] = useState(3);
const [showNaiveRoute, setShowNaiveRoute] = useState(false);
const [optimizedRouteData, setOptimizedRouteData] = useState(null);

// Stepwise animation states
const [animationPhase, setAnimationPhase] = useState(0); // 0-3
const [phaseData, setPhaseData]     = useState(null);    // full stepwise result
const [clusterFrame, setClusterFrame] = useState(0);     // which K-Means iteration
const [clusteringDone, setClusteringDone] = useState(false);
const [currentZoneIdx, setCurrentZoneIdx] = useState(0); // which zone is animating in phase 2
const [zoneNNDone, setZoneNNDone]     = useState(false); // NN drawn, about to show 2-opt
const [zoneSwapIdx, setZoneSwapIdx]   = useState(0);     // which 2-opt swap
```

**3. Add `clusteringFrameTimer`** ref alongside the existing refs:
```jsx
const clusterFrameTimer = useRef(null);
const stepwisePhase = useRef(0);
```

**4. Replace `startClusteredAnimation`** entirely:

```jsx
function startClusteredAnimation() {
    if (!startNode || deliveryStops.length === 0) return;

    const depot = { id: startNode.id, lat: startNode.lat, lon: startNode.lon };
    const result = solveClusteredTspStepwise(depot, deliveryStops, k, state.current.graph);

    if (!result) {
        ui.current.showSnack("Failed to solve Clustered TSP routing.");
        return;
    }

    setPhaseData(result);
    setOptimizedRouteData(result.finalResult);
    setAnimationPhase(0);
    setClusterFrame(0);
    setClusteringDone(false);
    setCurrentZoneIdx(0);
    setZoneNNDone(false);
    setZoneSwapIdx(0);
    stepwisePhase.current = 0;
    setStarted(true);

    // Phase 1: animate K-Means frames with a timer
    animateClusteringPhase(result.phases[0]);
}

function animateClusteringPhase(clusteringPhase) {
    const frames = clusteringPhase.frames;
    let frameIdx = 0;

    // Clear any old timer
    if (clusterFrameTimer.current) clearInterval(clusterFrameTimer.current);

    clusterFrameTimer.current = setInterval(() => {
        frameIdx++;
        setClusterFrame(frameIdx);
        if (frameIdx >= frames.length - 1) {
            clearInterval(clusterFrameTimer.current);
            setClusteringDone(true);
            // Don't auto-advance — let the user press Next or wait 1.5s
            setTimeout(() => {
                if (stepwisePhase.current === 0) advanceToPhase(1);
            }, 1500);
        }
    }, 600); // 600ms per K-Means iteration frame — readable pace
}

function advanceToPhase(phaseIdx) {
    stepwisePhase.current = phaseIdx;
    setAnimationPhase(phaseIdx);

    if (phaseIdx === 1) {
        // Phase 2: intrazone — start animating zone 0
        setCurrentZoneIdx(0);
        setZoneNNDone(false);
        setZoneSwapIdx(0);
        animateIntrazonePhase(0);
    }
    else if (phaseIdx === 2) {
        // Phase 3: zone linking — build waypoints and play
        if (!phaseData) return;
        buildLinkingAnimation(phaseData.phases[2]);
    }
    else if (phaseIdx === 3) {
        // Phase 4: summary
        setStarted(false);
        setAnimationEnded(true);
    }
}

function animateIntrazonePhase(zoneIdx) {
    if (!phaseData) return;
    const zones = phaseData.phases[1].zones;
    if (zoneIdx >= zones.length) {
        // All zones done → move to phase 3
        setTimeout(() => advanceToPhase(2), 800);
        return;
    }

    const zone = zones[zoneIdx];
    setCurrentZoneIdx(zoneIdx);
    setZoneNNDone(false);
    setZoneSwapIdx(0);

    // Build and play NN segments for this zone
    buildIntrazoneAnimation(zone.nnSegments, zone.color, () => {
        setZoneNNDone(true);
        // Then animate 2-opt swaps one by one
        animateTwoOptSwaps(zoneIdx, zone, 0, () => {
            // Done with this zone → move to next
            setTimeout(() => animateIntrazonePhase(zoneIdx + 1), 600);
        });
    });
}

function animateTwoOptSwaps(zoneIdx, zone, swapIdx, onDone) {
    if (swapIdx >= zone.twoOptSwaps.length) {
        onDone();
        return;
    }
    setZoneSwapIdx(swapIdx);
    // Rebuild waypoints with this swap's improved path
    buildIntrazoneAnimation(zone.twoOptSwaps[swapIdx].segments, zone.color, () => {
        setTimeout(() => animateTwoOptSwaps(zoneIdx, zone, swapIdx + 1, onDone), 200);
    });
}

function buildIntrazoneAnimation(segments, color, onComplete) {
    let currentTimer = 0;
    const pathWaypoints = [];

    for (const seg of segments) {
        const path = seg.path || seg;
        for (let i = 0; i < path.length - 1; i++) {
            const node = path[i];
            const nextNode = path[i + 1];
            const distance = Math.hypot(
                (nextNode.longitude ?? nextNode.lon) - (node.longitude ?? node.lon),
                (nextNode.latitude  ?? nextNode.lat) - (node.latitude  ?? node.lat)
            );
            const timeAdd = distance * 50000;
            pathWaypoints.push({
                path: [
                    [node.longitude ?? node.lon, node.latitude ?? node.lat],
                    [nextNode.longitude ?? nextNode.lon, nextNode.latitude ?? nextNode.lat]
                ],
                timestamps: [currentTimer, currentTimer + timeAdd],
                color: color
            });
            currentTimer += timeAdd;
        }
    }

    waypoints.current = pathWaypoints;
    timer.current = currentTimer;
    setTripsData(pathWaypoints);

    if (onComplete) {
        // Fire onComplete after enough time for the animation to play
        setTimeout(onComplete, Math.min(currentTimer / 20, 2000));
    }
}

function buildLinkingAnimation(linkingPhase) {
    let currentTimer = 0;
    const pathWaypoints = [];

    for (const seg of linkingPhase.segments) {
        for (let i = 0; i < seg.path.length - 1; i++) {
            const node = seg.path[i];
            const nextNode = seg.path[i + 1];
            const distance = Math.hypot(
                (nextNode.longitude ?? nextNode.lon) - (node.longitude ?? node.lon),
                (nextNode.latitude  ?? nextNode.lat) - (node.latitude  ?? node.lat)
            );
            const timeAdd = distance * 50000;
            pathWaypoints.push({
                path: [
                    [node.longitude ?? node.lon, node.latitude ?? node.lat],
                    [nextNode.longitude ?? nextNode.lon, nextNode.latitude ?? nextNode.lat]
                ],
                timestamps: [currentTimer, currentTimer + timeAdd],
                color: 'connector'
            });
            currentTimer += timeAdd;
        }
    }

    waypoints.current = pathWaypoints;
    timer.current = currentTimer;
    setTripsData(pathWaypoints);
    setStarted(true);

    setTimeout(() => advanceToPhase(3), Math.min(currentTimer / 20, 3000));
}
```

**5. In `clearPath`**, also reset stepwise state:
```jsx
function clearPath() {
    setStarted(false);
    setTripsData([]);
    setTime(0);
    state.current.reset();
    waypoints.current = [];
    timer.current = 0;
    previousTimeRef.current = null;
    traceNode.current = null;
    traceNode2.current = null;
    setAnimationEnded(false);
    // Reset stepwise
    setAnimationPhase(0);
    setPhaseData(null);
    setClusterFrame(0);
    setClusteringDone(false);
    setCurrentZoneIdx(0);
    setZoneNNDone(false);
    setZoneSwapIdx(0);
    if (clusterFrameTimer.current) clearInterval(clusterFrameTimer.current);
}
```

**6. In the JSX, replace the `ScatterplotLayer` for delivery stops** so it reads cluster assignments from the live `clusterFrame` during phase 1:

```jsx
{/* During clustering phase: color stops by live assignment */}
<ScatterplotLayer 
    id="delivery-stops"
    data={deliveryStops.map((stop, idx) => {
        const ZONE_COLORS = {
            0: [0, 150, 136], 1: [255, 111, 0], 2: [255, 193, 7],
            3: [156, 39, 176], 4: [233, 30, 99], 5: [76, 175, 80],
            6: [33, 150, 243], 7: [255, 87, 34]
        };
        let color = [100, 100, 120]; // unassigned gray
        
        if (animationPhase === 0 && phaseData) {
            // Use live clustering frame assignment
            const frame = phaseData.phases[0].frames[Math.min(clusterFrame, phaseData.phases[0].frames.length - 1)];
            const assignedCluster = frame?.assignments?.[idx];
            if (assignedCluster !== undefined && assignedCluster !== -1) {
                color = ZONE_COLORS[assignedCluster] || color;
            }
        } else if (optimizedRouteData && stop.clusterId !== undefined) {
            color = ZONE_COLORS[stop.clusterId] || color;
        }
        
        return {
            coordinates: [stop.lon, stop.lat],
            color,
            lineColor: [255, 255, 255]
        };
    })}
    updateTriggers={{ getFillColor: [clusterFrame, animationPhase, optimizedRouteData] }}
    // ... rest of props unchanged
/>
```

**7. Add centroid markers layer** — add this in the JSX after the delivery stops layer:
```jsx
{/* Show K-Means centroids during Phase 1 */}
{animationPhase === 0 && phaseData && (() => {
    const frame = phaseData.phases[0].frames[Math.min(clusterFrame, phaseData.phases[0].frames.length - 1)];
    return frame?.centroids?.length > 0 ? (
        <ScatterplotLayer
            id="kmeans-centroids"
            data={frame.centroids.map((c, idx) => ({
                coordinates: [c.lon, c.lat],
                color: [255, 255, 255, 200]
            }))}
            radiusMinPixels={10}
            radiusMaxPixels={20}
            stroked={true}
            lineWidthMinPixels={2}
            getPosition={d => d.coordinates}
            getFillColor={[255, 255, 255, 40]}
            getLineColor={[255, 255, 255, 220]}
            updateTriggers={{ getPosition: [clusterFrame] }}
        />
    ) : null;
})()}
```

**8. Pass new props to `<Interface>`:**
```jsx
animationPhase={animationPhase}
phaseData={phaseData}
clusterFrame={clusterFrame}
clusteringDone={clusteringDone}
currentZoneIdx={currentZoneIdx}
zoneNNDone={zoneNNDone}
zoneSwapIdx={zoneSwapIdx}
advanceToPhase={advanceToPhase}
```

---

## `Interface.jsx` — Phase indicator + explanation card

**1. Add to the forwardRef props destructure:**
```jsx
animationPhase, phaseData, clusterFrame, clusteringDone,
currentZoneIdx, zoneNNDone, zoneSwapIdx, advanceToPhase
```

**2. Add a phase indicator bar** — place this just above `{routingMode === "clustered" && !cinematic && (` in the return:

```jsx
{/* Phase indicator — shown when CTSP animation is running */}
{routingMode === "clustered" && phaseData && !cinematic && (
    <div className="phase-indicator-bar">
        {[
            { label: "K-Means", icon: "⬡" },
            { label: "Intra-zone TSP", icon: "↻" },
            { label: "Zone linking", icon: "→" },
            { label: "Summary", icon: "✓" }
        ].map((p, idx) => (
            <div
                key={idx}
                className={`phase-step ${animationPhase === idx ? "active" : ""} ${animationPhase > idx ? "done" : ""}`}
                onClick={() => animationPhase > idx && advanceToPhase(idx)}
            >
                <span className="phase-icon">{p.icon}</span>
                <span className="phase-label">{p.label}</span>
                {idx < 3 && <span className="phase-arrow">›</span>}
            </div>
        ))}
    </div>
)}
```

**3. Replace the entire `{routingMode === "clustered" && !cinematic && (` panel** — add a phase-aware explanation card at the top of the `clustered-floating-panel`. Insert it as the first child, right after `<Typography variant="h6" className="panel-title">`:

```jsx
{/* Phase explanation card — shown during animation */}
{phaseData && (() => {
    const explanations = [
        {
            title: "K-Means Clustering",
            algo: "K-Means++ initialization → iterative reassignment",
            complexity: "O(n · k · iterations)",
            description: clusteringDone
                ? `Converged in ${phaseData.phases[0].frames.length - 1} iterations. ${deliveryStops.length} stops split into ${phaseData.phases[0].k} zones.`
                : `Iteration ${clusterFrame} of ${phaseData.phases[0].frames.length - 1}. Watch centroids (white rings) pull stops into zones.`,
            color: "#9b87f5"
        },
        {
            title: "Intra-zone TSP",
            algo: "Nearest Neighbor greedy → 2-opt refinement",
            complexity: "O(n²) NN + O(n²) 2-opt per zone",
            description: (() => {
                if (!phaseData.phases[1].zones[currentZoneIdx]) return "";
                const zone = phaseData.phases[1].zones[currentZoneIdx];
                const swaps = zone.twoOptSwaps.length;
                return zoneNNDone
                    ? `2-opt swap ${zoneSwapIdx}/${swaps} — reversing a sub-tour segment to reduce crossings.`
                    : `Drawing nearest-neighbor path for Zone ${currentZoneIdx + 1} of ${phaseData.phases[1].zones.length}.`;
            })(),
            color: "#1D9E75"
        },
        {
            title: "Zone sequencing",
            algo: "Nearest neighbor on zone centroids",
            complexity: "O(k²) — negligible for small k",
            description: `Connecting depot → zones → depot via shortest connector paths. Gray lines are inter-zone transitions.`,
            color: "#EF9F27"
        },
        {
            title: "Solution found",
            algo: "CTSP: K-Means + per-cluster 2-opt",
            complexity: "Total: O(n·k·i) + O(n²·k)",
            description: optimizedRouteData
                ? `Saved ${optimizedRouteData.stats.distanceSaved.toFixed(2)} km vs naive (${optimizedRouteData.stats.percentageReduction.toFixed(1)}% reduction).`
                : "",
            color: "#D85A30"
        }
    ][animationPhase];

    return (
        <div className="phase-explanation-card" style={{ borderLeftColor: explanations.color }}>
            <div className="phase-card-title" style={{ color: explanations.color }}>{explanations.title}</div>
            <div className="phase-card-algo">{explanations.algo}</div>
            <div className="phase-card-complexity">complexity: {explanations.complexity}</div>
            <div className="phase-card-desc">{explanations.description}</div>
        </div>
    );
})()}

{/* Manual next/prev phase controls */}
{phaseData && animationPhase < 3 && (
    <div className="phase-controls">
        <button
            className="phase-ctrl-btn"
            onClick={() => advanceToPhase(Math.max(0, animationPhase - 1))}
            disabled={animationPhase === 0}
        >
            ‹ Prev phase
        </button>
        <button
            className="phase-ctrl-btn primary"
            onClick={() => advanceToPhase(animationPhase + 1)}
        >
            Skip to next ›
        </button>
    </div>
)}
```

---

## `index.scss` — Add styles for new components

```scss
/* ── Phase indicator bar ──────────────────────────────────── */
.phase-indicator-bar {
    position: fixed;
    bottom: 28px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    background: rgba(31, 32, 41, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 32px;
    padding: 8px 18px;
    z-index: 1001;
    backdrop-filter: blur(12px);
    gap: 4px;
    box-shadow: 0 4px 24px rgba(0,0,0,0.4);

    .phase-step {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        border-radius: 20px;
        font-size: 12px;
        font-weight: 600;
        color: rgba(255, 255, 255, 0.35);
        transition: all 250ms ease;
        white-space: nowrap;

        &.active {
            color: #fff;
            background: rgba(255, 255, 255, 0.1);
        }

        &.done {
            color: #46B780;
            cursor: pointer;
            &:hover { background: rgba(70, 183, 128, 0.1); }
        }

        .phase-icon { font-size: 13px; }
        .phase-label { font-size: 11px; }
    }

    .phase-arrow {
        color: rgba(255, 255, 255, 0.15);
        font-size: 16px;
        margin: 0 2px;
    }
}

/* ── Phase explanation card ──────────────────────────────── */
.phase-explanation-card {
    background: rgba(0, 0, 0, 0.2);
    border-left: 3px solid #46B780;
    border-radius: 0 8px 8px 0;
    padding: 12px 14px;
    transition: border-color 400ms ease;

    .phase-card-title {
        font-size: 13px;
        font-weight: 700;
        letter-spacing: 0.3px;
        margin-bottom: 3px;
    }

    .phase-card-algo {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.8);
        font-family: monospace;
        margin-bottom: 4px;
    }

    .phase-card-complexity {
        font-size: 10px;
        color: rgba(255, 255, 255, 0.4);
        font-family: monospace;
        margin-bottom: 6px;
    }

    .phase-card-desc {
        font-size: 11px;
        color: rgba(255, 255, 255, 0.6);
        line-height: 1.5;
    }
}

/* ── Phase prev/next controls ────────────────────────────── */
.phase-controls {
    display: flex;
    gap: 8px;

    .phase-ctrl-btn {
        flex: 1;
        padding: 6px 10px;
        border-radius: 6px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: transparent;
        color: rgba(255, 255, 255, 0.6);
        font-size: 11px;
        font-weight: 600;
        cursor: pointer;
        transition: all 200ms;
        font-family: inherit;

        &:hover:not(:disabled) { background: rgba(255,255,255,0.06); color: #fff; }
        &:disabled { opacity: 0.3; cursor: not-allowed; }

        &.primary {
            border-color: #46B780;
            color: #46B780;
            &:hover { background: rgba(70, 183, 128, 0.12); }
        }
    }
}
```

---

## Summary of what changes and why

| File | What changes | Why |
|---|---|---|
| `RoutingService.js` | Add `solveClusteredTspStepwise()` | Returns intermediate K-Means frames + per-zone NN steps + 2-opt swaps instead of just the final route |
| `Map.jsx` | Replace `startClusteredAnimation` with 5 phase-specific functions | Each phase drives its own animation loop; centroid layer and per-stop coloring update live per frame |
| `Map.jsx` | New `animationPhase`, `clusterFrame`, `currentZoneIdx` etc state | Gives `Interface` the info it needs to show the right explanation at the right moment |
| `Interface.jsx` | Phase indicator bar at bottom of screen | Shows which of the 4 stages is active; completed stages are clickable to go back |
| `Interface.jsx` | Phase explanation card at top of panel | Shows algorithm name, Big-O complexity, and a live description updating as the animation progresses (e.g. "Iteration 3 of 5" during K-Means) |
| `Interface.jsx` | Prev/Next phase buttons | User can pause, read, then manually advance — not forced to watch at animation speed |
| `index.scss` | 3 new CSS blocks | Styles the pill bar, card, and control buttons |

The biggest conceptual shift is that `solveClusteredTspStepwise` now runs the algorithm in a way that **records every intermediate state** — each K-Means iteration, each NN step, each 2-opt swap — and the animation engine plays those states back sequentially rather than just drawing the final answer.