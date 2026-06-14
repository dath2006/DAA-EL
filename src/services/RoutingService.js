export function getDistanceInKm(lat1, lon1, lat2, lon2) {
    const R = 6371; // Radius of the earth in km
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLon = ((lon2 - lon1) * Math.PI) / 180;
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos((lat1 * Math.PI) / 180) *
            Math.cos((lat2 * Math.PI) / 180) *
            Math.sin(dLon / 2) *
            Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c; // Distance in km
}

function getDistanceInDegrees(n1, n2) {
    return Math.hypot(n1.latitude - n2.latitude, n1.longitude - n2.longitude);
}

import AStar from "../models/algorithms/AStar";
import BidirectionalSearch from "../models/algorithms/BidirectionalSearch";
import Dijkstra from "../models/algorithms/Dijkstra";
import Greedy from "../models/algorithms/Greedy";

/**
 * Synchronous pathfinder on the loaded local graph.
 * Find shortest path between two nodes in terms of graph edge weights.
 */
export function findShortestPathSync(startNode, endNode, graph, algorithmName = "astar") {
    if (!startNode || !endNode || !graph) return null;
    if (startNode.id === endNode.id) return { distance: 0, path: [startNode] };

    // Reset nodes
    for (const key of graph.nodes.keys()) {
        graph.nodes.get(key).reset();
    }

    let algo;
    switch (algorithmName) {
        case "astar": algo = new AStar(); break;
        case "dijkstra": algo = new Dijkstra(); break;
        case "greedy": algo = new Greedy(); break;
        case "bidirectional": algo = new BidirectionalSearch(); break;
        default: algo = new AStar(); break;
    }

    algo.start(startNode, endNode);

    let safetyCount = 0;
    let finalPath = [];
    while (!algo.finished && safetyCount < 500000) {
        const updated = algo.nextStep();
        safetyCount++;
        
        if (algo.finished) {
            if (algorithmName !== "bidirectional") {
                let temp = endNode;
                while (temp) {
                    finalPath.push(temp);
                    temp = temp.parent;
                }
                finalPath.reverse();
            } else {
                let intersection = updated.length > 0 ? updated[updated.length - 1] : null;
                if (intersection) {
                    let pathA = [];
                    let currA = intersection;
                    while(currA) { pathA.push(currA); currA = currA.parent; }

                    let pathB = [];
                    let currB = intersection.prevParent;
                    if (!currB && intersection.id !== startNode.id && intersection.id !== endNode.id) {
                        const otherNeighbor = intersection.neighbors.find(n => n.node.parent && n.node.parent.id !== pathA[1]?.id);
                        if (otherNeighbor) currB = otherNeighbor.node;
                    }

                    while(currB) { pathB.push(currB); currB = currB.parent; }

                    let pathA_reachesStart = pathA.length > 0 && pathA[pathA.length - 1].id === startNode.id;
                    let pathB_reachesStart = pathB.length > 0 && pathB[pathB.length - 1].id === startNode.id;

                    if (pathA_reachesStart) {
                        pathA.reverse();
                        finalPath = [...pathA, ...pathB];
                    } else if (pathB_reachesStart) {
                        pathB.reverse();
                        finalPath = [...pathB, ...pathA];
                    } else {
                        finalPath = pathA;
                    }
                }
            }
            break;
        }
    }

    // Fallback if path finishes but no valid path was populated (e.g. unreachable)
    if (finalPath.length > 0 && finalPath[finalPath.length - 1].id === endNode.id) {
        let distanceInKm = 0;
        for (let i = 0; i < finalPath.length - 1; i++) {
            distanceInKm += getDistanceInKm(
                finalPath[i].latitude ?? finalPath[i].lat, 
                finalPath[i].longitude ?? finalPath[i].lon, 
                finalPath[i + 1].latitude ?? finalPath[i + 1].lat, 
                finalPath[i + 1].longitude ?? finalPath[i + 1].lon
            );
        }
        return { distance: distanceInKm, path: finalPath };
    }

    return null; // Path not found
}

/**
 * K-Means from scratch using K-Means++ initialization
 */
export function kMeansClustering(stops, k) {
    if (stops.length === 0) return { clusters: [], centroids: [], assignments: [] };
    const actualK = Math.max(1, Math.min(stops.length, k));

    // 1. K-Means++ Centroid Initialization
    const centroids = [];
    // Start with a random stop
    const firstStopIdx = Math.floor(Math.random() * stops.length);
    centroids.push({ lat: stops[firstStopIdx].lat, lon: stops[firstStopIdx].lon });

    for (let c = 1; c < actualK; c++) {
        const distSq = stops.map(stop => {
            let minDist = Infinity;
            for (const centroid of centroids) {
                const d = Math.pow(stop.lat - centroid.lat, 2) + Math.pow(stop.lon - centroid.lon, 2);
                if (d < minDist) minDist = d;
            }
            return minDist;
        });

        const sumDist = distSq.reduce((sum, d) => sum + d, 0);
        let r = Math.random() * sumDist;
        let cumulative = 0;
        let nextCentroid = stops[stops.length - 1];

        for (let i = 0; i < stops.length; i++) {
            cumulative += distSq[i];
            if (r <= cumulative) {
                nextCentroid = stops[i];
                break;
            }
        }
        centroids.push({ lat: nextCentroid.lat, lon: nextCentroid.lon });
    }

    // 2. K-Means Iterative Assignments
    let assignments = new Array(stops.length).fill(-1);
    let converged = false;
    let iterations = 0;
    const maxIterations = 100;

    while (!converged && iterations < maxIterations) {
        converged = true;
        iterations++;

        // Assign stops to nearest centroid
        for (let i = 0; i < stops.length; i++) {
            const stop = stops[i];
            let minDist = Infinity;
            let nearestIdx = -1;

            for (let cIdx = 0; cIdx < actualK; cIdx++) {
                const c = centroids[cIdx];
                const d = Math.pow(stop.lat - c.lat, 2) + Math.pow(stop.lon - c.lon, 2);
                if (d < minDist) {
                    minDist = d;
                    nearestIdx = cIdx;
                }
            }

            if (assignments[i] !== nearestIdx) {
                assignments[i] = nearestIdx;
                converged = false;
            }
        }

        // Recompute centroids
        if (!converged) {
            const sumCoords = Array.from({ length: actualK }, () => ({ sumLat: 0, sumLon: 0, count: 0 }));
            for (let i = 0; i < stops.length; i++) {
                const cIdx = assignments[i];
                sumCoords[cIdx].sumLat += stops[i].lat;
                sumCoords[cIdx].sumLon += stops[i].lon;
                sumCoords[cIdx].count++;
            }

            for (let cIdx = 0; cIdx < actualK; cIdx++) {
                const sc = sumCoords[cIdx];
                if (sc.count > 0) {
                    centroids[cIdx] = {
                        lat: sc.sumLat / sc.count,
                        lon: sc.sumLon / sc.count
                    };
                }
            }
        }
    }

    // Form cluster lists
    const clusters = Array.from({ length: actualK }, (_, idx) => ({
        id: idx,
        centroid: centroids[idx],
        stops: []
    }));

    for (let i = 0; i < stops.length; i++) {
        const cIdx = assignments[i];
        if (cIdx !== -1 && clusters[cIdx]) {
            clusters[cIdx].stops.push(stops[i]);
        }
    }

    return { clusters, centroids, assignments };
}

/**
 * Calculates WCSS for 1 to min(N, maxK) for Elbow method
 */
export function getElbowData(stops, maxK = 8) {
    if (stops.length === 0) return [];
    const elbowData = [];
    const limit = Math.min(stops.length, maxK);

    for (let k = 1; k <= limit; k++) {
        const { clusters } = kMeansClustering(stops, k);
        let wcss = 0;
        for (const cluster of clusters) {
            const centroid = cluster.centroid;
            for (const stop of cluster.stops) {
                const d = getDistanceInKm(stop.lat, stop.lon, centroid.lat, centroid.lon);
                wcss += d * d;
            }
        }
        elbowData.push({ k, wcss });
    }
    return elbowData;
}

/**
 * Solve TSP using Nearest Neighbor + 2-opt Refinement
 */
export function solveTspNearestNeighbor2Opt(stops, distanceMatrix) {
    const n = stops.length;
    if (n === 0) return [];
    if (n === 1) return [0];
    if (n === 2) return [0, 1];

    let bestTour = [];
    let bestTourDistance = Infinity;

    // Try multiple start stops for NN
    for (let start = 0; start < n; start++) {
        const tour = [start];
        const visited = new Set([start]);
        let current = start;

        while (tour.length < n) {
            let nextNode = -1;
            let minDist = Infinity;
            for (let i = 0; i < n; i++) {
                if (!visited.has(i)) {
                    const dist = distanceMatrix[current][i];
                    if (dist < minDist) {
                        minDist = dist;
                        nextNode = i;
                    }
                }
            }
            tour.push(nextNode);
            visited.add(nextNode);
            current = nextNode;
        }

        let dist = 0;
        for (let i = 0; i < n; i++) {
            dist += distanceMatrix[tour[i]][tour[(i + 1) % n]];
        }

        if (dist < bestTourDistance) {
            bestTourDistance = dist;
            bestTour = tour;
        }
    }

    // 2-opt refinement
    const tour = [...bestTour];
    let improved = true;
    let iteration = 0;
    const maxIterations = 500;

    while (improved && iteration < maxIterations) {
        improved = false;
        iteration++;

        for (let i = 1; i < n - 1; i++) {
            for (let j = i + 1; j < n; j++) {
                const a = tour[i - 1];
                const b = tour[i];
                const c = tour[j];
                const d = tour[(j + 1) % n];

                const oldDist = distanceMatrix[a][b] + distanceMatrix[c][d];
                const newDist = distanceMatrix[a][c] + distanceMatrix[b][d];

                if (newDist < oldDist - 1e-9) {
                    reverseSubArray(tour, i, j);
                    improved = true;
                }
            }
        }
    }

    return tour;
}

function reverseSubArray(arr, start, end) {
    while (start < end) {
        const temp = arr[start];
        arr[start] = arr[end];
        arr[end] = temp;
        start++;
        end--;
    }
}

/**
 * Solve TSP exactly using Held-Karp Dynamic Programming.
 * O(n^2 * 2^n) time complexity. Hard limited to 18 stops.
 */
export function solveTspHeldKarp(stops, distanceMatrix) {
    const n = stops.length;
    if (n === 0) return [];
    if (n === 1) return [0];
    if (n === 2) return [0, 1];

    if (n > 18) {
        throw new Error(`Held-Karp algorithm cannot handle more than 18 stops per cluster due to memory/time constraints. You currently have ${n} stops in one cluster. Please use Nearest Neighbor or increase the number of clusters (k).`);
    }

    const numStates = 1 << n;
    // dp[mask][i] = min distance to visit 'mask' ending at 'i'
    const dp = Array.from({ length: numStates }, () => new Float32Array(n).fill(Infinity));
    const parent = Array.from({ length: numStates }, () => new Int32Array(n).fill(-1));

    // Base case: starting at node 0
    dp[1][0] = 0;

    for (let mask = 1; mask < numStates; mask += 2) {
        for (let u = 0; u < n; u++) {
            if ((mask & (1 << u)) === 0) continue;
            
            for (let v = 0; v < n; v++) {
                if ((mask & (1 << v)) !== 0) continue;
                
                const nextMask = mask | (1 << v);
                const newDist = dp[mask][u] + distanceMatrix[u][v];
                
                if (newDist < dp[nextMask][v]) {
                    dp[nextMask][v] = newDist;
                    parent[nextMask][v] = u;
                }
            }
        }
    }

    // Connect back to 0
    let bestDist = Infinity;
    let endNode = -1;
    const fullMask = numStates - 1;

    for (let u = 1; u < n; u++) {
        const dist = dp[fullMask][u] + distanceMatrix[u][0];
        if (dist < bestDist) {
            bestDist = dist;
            endNode = u;
        }
    }

    if (endNode === -1) return [];

    // Traceback
    const tour = [];
    let currentMask = fullMask;
    let curr = endNode;
    
    while (curr !== -1) {
        tour.push(curr);
        const p = parent[currentMask][curr];
        currentMask ^= (1 << curr);
        curr = p;
    }
    
    tour.reverse();
    return tour;
}

/**
 * Sequences clusters by centroids using Nearest Neighbor from Depot
 */
export function sequenceZones(depot, zones) {
    const visited = new Set();
    const orderedZones = [];
    let currentPos = { lat: depot.lat, lon: depot.lon };

    while (orderedZones.length < zones.length) {
        let nearestZone = null;
        let minDist = Infinity;

        for (const z of zones) {
            if (!visited.has(z.id)) {
                const dist = Math.pow(z.centroid.lat - currentPos.lat, 2) + Math.pow(z.centroid.lon - currentPos.lon, 2);
                if (dist < minDist) {
                    minDist = dist;
                    nearestZone = z;
                }
            }
        }

        if (!nearestZone) break;
        visited.add(nearestZone.id);
        orderedZones.push(nearestZone);
        currentPos = nearestZone.centroid;
    }

    return orderedZones;
}

/**
 * Ramer-Douglas-Peucker Simplification
 */
function getSqSegDist(p, p1, p2) {
    let x = p1.lon,
        y = p1.lat,
        dx = p2.lon - x,
        dy = p2.lat - y;

    if (dx !== 0 || dy !== 0) {
        const t = ((p.lon - x) * dx + (p.lat - y) * dy) / (dx * dx + dy * dy);
        if (t > 1) {
            x = p2.lon;
            y = p2.lat;
        } else if (t > 0) {
            x += dx * t;
            y += dy * t;
        }
    }
    dx = p.lon - x;
    dy = p.lat - y;
    return dx * dx + dy * dy;
}

function simplifyDPStep(points, first, last, sqTolerance, simplified) {
    let maxSqDist = sqTolerance,
        index = -1;

    for (let i = first + 1; i < last; i++) {
        const sqDist = getSqSegDist(points[i], points[first], points[last]);
        if (sqDist > maxSqDist) {
            index = i;
            maxSqDist = sqDist;
        }
    }

    if (maxSqDist > sqTolerance) {
        if (index - first > 1) simplifyDPStep(points, first, index, sqTolerance, simplified);
        simplified.push(points[index]);
        if (last - index > 1) simplifyDPStep(points, index, last, sqTolerance, simplified);
    }
}

export function simplifyPath(points, tolerance = 0.0001) {
    if (points.length <= 2) return points;
    const sqTolerance = tolerance * tolerance;
    const simplified = [points[0]];
    simplifyDPStep(points, 0, points.length - 1, sqTolerance, simplified);
    simplified.push(points[points.length - 1]);
    return simplified;
}

/**
 * Counts path crossings using simplified road points
 */
export function countCrossings(pathPoints) {
    if (pathPoints.length < 4) return 0;
    
    // Convert pathPoints to {lat, lon} array if they are in coordinate list
    const coords = pathPoints.map(p => {
        if (Array.isArray(p)) return { lon: p[0], lat: p[1] };
        return { lat: p.lat ?? p.latitude, lon: p.lon ?? p.longitude };
    });

    const simplified = simplifyPath(coords, 0.00005); // ~5 meters
    const m = simplified.length;
    let crossings = 0;

    function ccw(A, B, C) {
        return (C.lat - A.lat) * (B.lon - A.lon) > (B.lat - A.lat) * (C.lon - A.lon);
    }

    function intersect(A, B, C, D) {
        return ccw(A, C, D) !== ccw(B, C, D) && ccw(A, B, C) !== ccw(A, B, D);
    }

    for (let i = 0; i < m - 1; i++) {
        for (let j = i + 2; j < m - 1; j++) {
            if (i === 0 && j === m - 2) continue; // Skip start-end join of loop
            if (intersect(simplified[i], simplified[i + 1], simplified[j], simplified[j + 1])) {
                crossings++;
            }
        }
    }

    return crossings;
}

/**
 * Full pipeline solver for Clustered TSP (CTSP)
 */
export function solveClusteredTsp(depot, stops, k, graph, algorithmName = "astar", tspAlgorithm = "nn_2opt") {
    if (!depot || stops.length === 0 || !graph) return null;

    // 1. Assign zones using K-Means
    const { clusters, assignments } = kMeansClustering(stops, k);

    // Save assignments back to stops
    const stopsWithCluster = stops.map((stop, idx) => ({
        ...stop,
        clusterId: assignments[idx]
    }));

    // Update clusters with stops details
    const activeClusters = clusters.filter(c => c.stops.length > 0);
    const kActual = activeClusters.length;

    // 2. Solve TSP within each cluster independently
    // For each cluster, we compute a road distance matrix and find TSP sequence.
    const clusterTours = [];
    for (const cluster of activeClusters) {
        const clusterStops = cluster.stops;
        const m = clusterStops.length;
        
        // Map stops to graph nodes
        const stopNodes = clusterStops.map(stop => {
            // Find nearest node in graph
            let nearestNode = null;
            let minDist = Infinity;
            for (const node of graph.nodes.values()) {
                const d = Math.pow(node.latitude - stop.lat, 2) + Math.pow(node.longitude - stop.lon, 2);
                if (d < minDist) {
                    minDist = d;
                    nearestNode = node;
                }
            }
            return nearestNode;
        });

        // Compute pairwise road distance matrix
        const distMatrix = Array.from({ length: m }, () => new Array(m).fill(0));
        const pathMatrix = Array.from({ length: m }, () => new Array(m).fill(null));

        for (let i = 0; i < m; i++) {
            for (let j = i + 1; j < m; j++) {
                const pathResult = findShortestPathSync(stopNodes[i], stopNodes[j], graph, algorithmName);
                if (pathResult) {
                    distMatrix[i][j] = pathResult.distance;
                    distMatrix[j][i] = pathResult.distance;
                    pathMatrix[i][j] = pathResult.path;
                    // Reverse path for back direction
                    pathMatrix[j][i] = [...pathResult.path].reverse();
                } else {
                    // Fallback to straight-line distance if graph path doesn't exist
                    const straightDist = getDistanceInKm(clusterStops[i].lat, clusterStops[i].lon, clusterStops[j].lat, clusterStops[j].lon);
                    distMatrix[i][j] = straightDist;
                    distMatrix[j][i] = straightDist;
                }
            }
        }

        // Solve TSP on this cluster
        let tspTourIdxs;
        if (tspAlgorithm === "held_karp") {
            tspTourIdxs = solveTspHeldKarp(clusterStops, distMatrix);
        } else {
            tspTourIdxs = solveTspNearestNeighbor2Opt(clusterStops, distMatrix);
        }
        clusterTours.push({
            clusterId: cluster.id,
            stops: tspTourIdxs.map(idx => clusterStops[idx]),
            nodes: tspTourIdxs.map(idx => stopNodes[idx]),
            distMatrix,
            pathMatrix,
            tourOrder: tspTourIdxs
        });
    }

    // 3. Sequence clusters using centroids
    const sequencedClusters = sequenceZones(depot, activeClusters);
    
    // Find the nearest graph node for the Depot
    let depotNode = null;
    let minDepotDist = Infinity;
    for (const node of graph.nodes.values()) {
        const d = Math.pow(node.latitude - depot.lat, 2) + Math.pow(node.longitude - depot.lon, 2);
        if (d < minDepotDist) {
            minDepotDist = d;
            depotNode = node;
        }
    }

    // 4. Link loops together
    const finalOptimizedRoute = []; // [{ from, to, path: [...], type: 'zone-X' | 'connector' }]
    let currentExitNode = depotNode;
    let currentExitCoord = { lat: depot.lat, lon: depot.lon };

    for (let cIdx = 0; cIdx < kActual; cIdx++) {
        const activeCluster = sequencedClusters[cIdx];
        const tour = clusterTours.find(t => t.clusterId === activeCluster.id);
        const m = tour.stops.length;

        // Find entry stop closest to the current exit coordinate
        let entryIdx = 0;
        let minEntryDist = Infinity;
        for (let i = 0; i < m; i++) {
            const d = getDistanceInKm(currentExitCoord.lat, currentExitCoord.lon, tour.stops[i].lat, tour.stops[i].lon);
            if (d < minEntryDist) {
                minEntryDist = d;
                entryIdx = i;
            }
        }

        // Determine traversal direction of the cluster's TSP cycle
        // If we go entry -> entry+1 -> ... -> entry-1 (Forward)
        // or entry -> entry-1 -> ... -> entry+1 (Backward)
        const forwardTour = [];
        for (let i = 0; i < m; i++) {
            forwardTour.push((entryIdx + i) % m);
        }
        const backwardTour = [entryIdx];
        for (let i = 1; i < m; i++) {
            backwardTour.push((entryIdx - i + m) % m);
        }

        // We choose the tour where the exit node is closer to the next target
        // Next target is next cluster centroid, or depot if last
        const nextTargetCoord = (cIdx < kActual - 1) 
            ? sequencedClusters[cIdx + 1].centroid 
            : { lat: depot.lat, lon: depot.lon };

        const exitIdxForward = forwardTour[m - 1];
        const exitIdxBackward = backwardTour[m - 1];

        const distForward = getDistanceInKm(tour.stops[exitIdxForward].lat, tour.stops[exitIdxForward].lon, nextTargetCoord.lat, nextTargetCoord.lon);
        const distBackward = getDistanceInKm(tour.stops[exitIdxBackward].lat, tour.stops[exitIdxBackward].lon, nextTargetCoord.lat, nextTargetCoord.lon);

        const selectedTourIdxs = (distForward <= distBackward) ? forwardTour : backwardTour;

        // Add connector from previous exit to entry of this zone
        const entryNode = tour.nodes[entryIdx];
        const entryCoord = tour.stops[entryIdx];
        let connPath = findShortestPathSync(currentExitNode, entryNode, graph, algorithmName);
        
        finalOptimizedRoute.push({
            from: currentExitCoord,
            to: entryCoord,
            path: connPath ? connPath.path : [currentExitNode, entryNode], // fallback
            type: "connector",
            distance: connPath ? connPath.distance : getDistanceInKm(currentExitCoord.lat, currentExitCoord.lon, entryCoord.lat, entryCoord.lon)
        });

        // Add internal cluster paths
        for (let i = 0; i < m - 1; i++) {
            const idx1 = selectedTourIdxs[i];
            const idx2 = selectedTourIdxs[i + 1];
            const origIdx1 = tour.tourOrder[idx1];
            const origIdx2 = tour.tourOrder[idx2];
            const stopPath = tour.pathMatrix[origIdx1][origIdx2] || [tour.nodes[idx1], tour.nodes[idx2]];
            const stopDist = tour.distMatrix[origIdx1][origIdx2];

            finalOptimizedRoute.push({
                from: tour.stops[idx1],
                to: tour.stops[idx2],
                path: stopPath,
                type: `zone-${activeCluster.id}`,
                distance: stopDist
            });
        }

        // Set exit for next iteration
        const lastIdx = selectedTourIdxs[m - 1];
        currentExitNode = tour.nodes[lastIdx];
        currentExitCoord = tour.stops[lastIdx];
    }

    // Connect last exit back to Depot
    let returnPath = findShortestPathSync(currentExitNode, depotNode, graph, algorithmName);
    finalOptimizedRoute.push({
        from: currentExitCoord,
        to: { lat: depot.lat, lon: depot.lon },
        path: returnPath ? returnPath.path : [currentExitNode, depotNode],
        type: "connector",
        distance: returnPath ? returnPath.distance : getDistanceInKm(currentExitCoord.lat, currentExitCoord.lon, depot.lat, depot.lon)
    });

    // 5. Compute Naive Route (Input Order: Depot -> D1 -> D2 -> ... -> Dn -> Depot)
    const finalNaiveRoute = [];
    let naiveCurrentNode = depotNode;
    let naiveCurrentCoord = { lat: depot.lat, lon: depot.lon };

    for (let i = 0; i < stops.length; i++) {
        const nextStopCoord = stops[i];
        // Find nearest node for next stop
        let nextStopNode = null;
        let minStopDist = Infinity;
        for (const node of graph.nodes.values()) {
            const d = Math.pow(node.latitude - nextStopCoord.lat, 2) + Math.pow(node.longitude - nextStopCoord.lon, 2);
            if (d < minStopDist) {
                minStopDist = d;
                nextStopNode = node;
            }
        }

        const pathResult = findShortestPathSync(naiveCurrentNode, nextStopNode, graph, algorithmName);
        finalNaiveRoute.push({
            from: naiveCurrentCoord,
            to: nextStopCoord,
            path: pathResult ? pathResult.path : [naiveCurrentNode, nextStopNode],
            type: "naive",
            distance: pathResult ? pathResult.distance : getDistanceInKm(naiveCurrentCoord.lat, naiveCurrentCoord.lon, nextStopCoord.lat, nextStopCoord.lon)
        });

        naiveCurrentNode = nextStopNode;
        naiveCurrentCoord = nextStopCoord;
    }

    // Connect last naive stop back to depot
    const finalNaiveReturn = findShortestPathSync(naiveCurrentNode, depotNode, graph, algorithmName);
    finalNaiveRoute.push({
        from: naiveCurrentCoord,
        to: { lat: depot.lat, lon: depot.lon },
        path: finalNaiveReturn ? finalNaiveReturn.path : [naiveCurrentNode, depotNode],
        type: "naive",
        distance: finalNaiveReturn ? finalNaiveReturn.distance : getDistanceInKm(naiveCurrentCoord.lat, naiveCurrentCoord.lon, depot.lat, depot.lon)
    });

    // 6. Calculate Stats
    const totalDistOptimized = finalOptimizedRoute.reduce((sum, s) => sum + s.distance, 0);
    const totalDistNaive = finalNaiveRoute.reduce((sum, s) => sum + s.distance, 0);
    const distSaved = Math.max(0, totalDistNaive - totalDistOptimized);
    const pctReduction = totalDistNaive > 0 ? (distSaved / totalDistNaive) * 100 : 0;

    // Collect full coordinate points for crossing counts
    const optimizedPoints = [];
    for (const seg of finalOptimizedRoute) {
        for (const node of seg.path) {
            optimizedPoints.push([node.longitude ?? node.lon, node.latitude ?? node.lat]);
        }
    }

    const naivePoints = [];
    for (const seg of finalNaiveRoute) {
        for (const node of seg.path) {
            naivePoints.push([node.longitude ?? node.lon, node.latitude ?? node.lat]);
        }
    }

    const crossingsNaive = countCrossings(naivePoints);
    const crossingsOptimized = countCrossings(optimizedPoints);
    const crossingsSaved = Math.max(0, crossingsNaive - crossingsOptimized);

    return {
        stops: stopsWithCluster,
        clusters: activeClusters.map(c => ({
            ...c,
            centroid: c.centroid,
            stops: stopsWithCluster.filter(s => s.clusterId === c.id)
        })),
        optimizedRoute: finalOptimizedRoute,
        naiveRoute: finalNaiveRoute,
        stats: {
            naiveDistance: totalDistNaive,
            optimizedDistance: totalDistOptimized,
            distanceSaved: distSaved,
            percentageReduction: pctReduction,
            naiveCrossings: crossingsNaive,
            optimizedCrossings: crossingsOptimized,
            crossingsSaved: crossingsSaved
        }
    };
}

/**
 * Cheapest Insertion Algorithm — O(n²)
 * Inserts a new stop into an existing ordered route at the position
 * that causes minimum increase in total route distance.
 * Returns the new route segments in order.
 */
export function cheapestInsertion(newStop, existingTourStops) {
    // existingTourStops: array of {id, lat, lon} including depot at [0] and end
    const n = existingTourStops.length;
    if (n < 2) return null;

    let bestCost = Infinity;
    let bestInsertAfter = 0; // insert after index i, before index i+1

    for (let i = 0; i < n - 1; i++) {
        const a = existingTourStops[i];
        const b = existingTourStops[i + 1];
        const dAB = getDistanceInKm(a.lat, a.lon, b.lat, b.lon);
        const dAN = getDistanceInKm(a.lat, a.lon, newStop.lat, newStop.lon);
        const dNB = getDistanceInKm(newStop.lat, newStop.lon, b.lat, b.lon);
        const insertionCost = dAN + dNB - dAB;
        if (insertionCost < bestCost) {
            bestCost = insertionCost;
            bestInsertAfter = i;
        }
    }

    const newTour = [
        ...existingTourStops.slice(0, bestInsertAfter + 1),
        newStop,
        ...existingTourStops.slice(bestInsertAfter + 1)
    ];

    return { newTour, insertedAfter: bestInsertAfter, insertionCost: bestCost };
}

/**
 * Nearest Neighbor greedy TSP — O(n²), no refinement.
 * Used for the face-off "naive" side.
 */
export function solveNaiveTsp(depot, stops, graph) {
    if (!depot || stops.length === 0 || !graph) return null;

    // Find depot node
    let depotNode = null, minD = Infinity;
    for (const node of graph.nodes.values()) {
        const d = Math.pow(node.latitude - depot.lat, 2) + Math.pow(node.longitude - depot.lon, 2);
        if (d < minD) { minD = d; depotNode = node; }
    }

    const route = [];
    let currentNode = depotNode;
    let currentCoord = { lat: depot.lat, lon: depot.lon };
    const remaining = [...stops];

    while (remaining.length > 0) {
        // Find nearest unvisited stop
        let nearest = null, nearestIdx = -1, nearestDist = Infinity;
        for (let i = 0; i < remaining.length; i++) {
            const d = getDistanceInKm(currentCoord.lat, currentCoord.lon, remaining[i].lat, remaining[i].lon);
            if (d < nearestDist) { nearestDist = d; nearest = remaining[i]; nearestIdx = i; }
        }

        // Find node for nearest stop
        let nearestNode = null, minN = Infinity;
        for (const node of graph.nodes.values()) {
            const d = Math.pow(node.latitude - nearest.lat, 2) + Math.pow(node.longitude - nearest.lon, 2);
            if (d < minN) { minN = d; nearestNode = node; }
        }

        const pathResult = findShortestPathSync(currentNode, nearestNode, graph, algorithmName);
        route.push({
            from: currentCoord, to: nearest,
            path: pathResult ? pathResult.path : [currentNode, nearestNode],
            type: "naive-nn",
            distance: pathResult ? pathResult.distance : getDistanceInKm(currentCoord.lat, currentCoord.lon, nearest.lat, nearest.lon)
        });

        currentNode = nearestNode;
        currentCoord = nearest;
        remaining.splice(nearestIdx, 1);
    }

    // Return to depot
    const returnPath = findShortestPathSync(currentNode, depotNode, graph, algorithmName);
    route.push({
        from: currentCoord, to: { lat: depot.lat, lon: depot.lon },
        path: returnPath ? returnPath.path : [currentNode, depotNode],
        type: "naive-nn",
        distance: returnPath ? returnPath.distance : getDistanceInKm(currentCoord.lat, currentCoord.lon, depot.lat, depot.lon)
    });

    const totalDist = route.reduce((s, r) => s + r.distance, 0);
    return { route, totalDistance: totalDist };
}

/**
 * Detects the elbow point in WCSS data using the "knee" method
 * (maximum distance from the line connecting first and last point)
 */
export function findElbowK(elbowData) {
    if (elbowData.length < 3) return elbowData[0]?.k ?? 1;

    const first = elbowData[0];
    const last = elbowData[elbowData.length - 1];

    // Line from first to last
    const dx = last.k - first.k;
    const dy = last.wcss - first.wcss;

    let maxDist = -Infinity;
    let elbowK = first.k;

    for (const point of elbowData) {
        // Perpendicular distance from point to line
        const dist = Math.abs(dy * point.k - dx * point.wcss + last.k * first.wcss - last.wcss * first.k)
            / Math.sqrt(dy * dy + dx * dx);
        if (dist > maxDist) {
            maxDist = dist;
            elbowK = point.k;
        }
    }

    return elbowK;
}

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
export function solveClusteredTspStepwise(depot, stops, k, graph, algorithmName = "astar", tspAlgorithm = "nn_2opt") {
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
                const pathResult = findShortestPathSync(stopNodes[i], stopNodes[j], graph, algorithmName);
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

        let finalTour;
        let nnPathSegments = [];
        let twoOptSwaps = [];

        if (tspAlgorithm === "held_karp") {
            finalTour = solveTspHeldKarp(cluster.stops, distMatrix);
            // Treat the optimal tour as the only "NN" segment and zero swaps
            for (let i = 0; i < m - 1; i++) {
                const p = pathMatrix[finalTour[i]][finalTour[i + 1]] || [stopNodes[finalTour[i]], stopNodes[finalTour[i + 1]]];
                nnPathSegments.push({ path: p, label: `Held-Karp: stop ${i + 1} → ${i + 2}` });
            }
            if (m > 1) {
                const p = pathMatrix[finalTour[m - 1]][finalTour[0]] || [stopNodes[finalTour[m - 1]], stopNodes[finalTour[0]]];
                nnPathSegments.push({ path: p, label: `Held-Karp: closing loop` });
            }
        } else {
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
            finalTour = [...nnTour];
            let improved = true;
            let iteration = 0;
            while (improved && iteration < 500) {
                improved = false; iteration++;
                for (let i = 1; i < m - 1; i++) {
                    for (let j = i + 1; j < m; j++) {
                        const a = finalTour[i - 1], b = finalTour[i], c = finalTour[j], d = finalTour[(j + 1) % m];
                        const oldDist = distMatrix[a][b] + distMatrix[c][d];
                        const newDist = distMatrix[a][c] + distMatrix[b][d];
                        if (newDist < oldDist - 1e-9) {
                            reverseSubArray(finalTour, i, j);
                            improved = true;
                            // Capture the improved tour as a sequence of path segments
                            const swapSegments = [];
                            for (let k = 0; k < m - 1; k++) {
                                const p = pathMatrix[finalTour[k]][finalTour[k + 1]] || [stopNodes[finalTour[k]], stopNodes[finalTour[k + 1]]];
                                swapSegments.push({ path: p });
                            }
                            const closeP = pathMatrix[finalTour[m - 1]][finalTour[0]] || [stopNodes[finalTour[m - 1]], stopNodes[finalTour[0]]];
                            swapSegments.push({ path: closeP });
                            twoOptSwaps.push({ segments: swapSegments, improvement: oldDist - newDist });
                        }
                    }
                }
            }
        }

        intrazoneSegments.push({
            clusterId: cluster.id,
            color,
            stopCount: m,         // exact number of stops in this zone
            nnSegments: nnPathSegments,
            twoOptSwaps, // can be empty if no improvement found
            finalTour: finalTour,
            finalSegments: finalTour.map((idx, i) => {
                const nextIdx = finalTour[(i + 1) % m];
                return pathMatrix[idx][nextIdx] || [stopNodes[idx], stopNodes[nextIdx]];
            })
        });

        clusterTours.push({ clusterId: cluster.id, stops: finalTour.map(i => cluster.stops[i]), nodes: finalTour.map(i => stopNodes[i]), distMatrix, pathMatrix, tourOrder: finalTour });
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

        // Determine traversal direction of the cluster's TSP cycle
        const forwardTour = [];
        for (let i = 0; i < m; i++) forwardTour.push((entryIdx + i) % m);
        const backwardTour = [entryIdx];
        for (let i = 1; i < m; i++) backwardTour.push((entryIdx - i + m) % m);

        // Target next cluster centroid or depot
        const nextTargetCoord = (cIdx < sequencedClusters.length - 1) 
            ? sequencedClusters[cIdx + 1].centroid 
            : { lat: depot.lat, lon: depot.lon };

        const exitIdxForward = forwardTour[m - 1];
        const exitIdxBackward = backwardTour[m - 1];

        const distForward = getDistanceInKm(tour.stops[exitIdxForward].lat, tour.stops[exitIdxForward].lon, nextTargetCoord.lat, nextTargetCoord.lon);
        const distBackward = getDistanceInKm(tour.stops[exitIdxBackward].lat, tour.stops[exitIdxBackward].lon, nextTargetCoord.lat, nextTargetCoord.lon);

        const selectedTourIdxs = (distForward <= distBackward) ? forwardTour : backwardTour;

        const entryNode = tour.nodes[entryIdx];
        const connPath = findShortestPathSync(currentExitNode, entryNode, graph, algorithmName);
        linkingSegments.push({
            type: 'connector',
            label: cIdx === 0 ? `Depot → Zone ${activeCluster.id}` : `Zone ${sequencedClusters[cIdx - 1].id} → Zone ${activeCluster.id}`,
            path: connPath ? connPath.path : [currentExitNode, entryNode],
            distance: connPath ? connPath.distance : getDistanceInKm(currentExitCoord.lat, currentExitCoord.lon, tour.stops[entryIdx].lat, tour.stops[entryIdx].lon),
            fromZone: cIdx === 0 ? 'depot' : sequencedClusters[cIdx - 1].id,
            toZone: activeCluster.id
        });

        // ── Traverse the zone's internal tour starting from entryIdx ──
        for (let i = 0; i < m - 1; i++) {
            const idx1 = selectedTourIdxs[i];
            const idx2 = selectedTourIdxs[i + 1];
            const origIdx1 = tour.tourOrder[idx1];
            const origIdx2 = tour.tourOrder[idx2];
            const segPath = tour.pathMatrix[origIdx1][origIdx2]
                || [tour.nodes[idx1], tour.nodes[idx2]];
            const segDist = tour.distMatrix[origIdx1][origIdx2];
            linkingSegments.push({
                type: `zone-${activeCluster.id}`,
                label: `Zone ${activeCluster.id}: stop ${i + 1} → ${i + 2}`,
                path: segPath,
                distance: segDist,
                zoneId: activeCluster.id
            });
        }

        const lastTourIdx = selectedTourIdxs[m - 1];
        currentExitNode = tour.nodes[lastTourIdx];
        currentExitCoord = tour.stops[lastTourIdx];
    }

    // Return to depot
    const returnPath = findShortestPathSync(currentExitNode, depotNode, graph, algorithmName);
    linkingSegments.push({
        type: 'return',
        label: 'Return to depot',
        path: returnPath ? returnPath.path : [currentExitNode, depotNode],
        distance: returnPath ? returnPath.distance : getDistanceInKm(currentExitCoord.lat, currentExitCoord.lon, depot.lat, depot.lon),
    });

    // ── Compute Naive Route for Stats ────────────────
    const finalNaiveRoute = [];
    let naiveCurrentNode = depotNode;
    let naiveCurrentCoord = { lat: depot.lat, lon: depot.lon };

    for (let i = 0; i < stops.length; i++) {
        const nextStopCoord = stops[i];
        let nextStopNode = null, minStopDist = Infinity;
        for (const node of graph.nodes.values()) {
            const d = Math.pow(node.latitude - nextStopCoord.lat, 2) + Math.pow(node.longitude - nextStopCoord.lon, 2);
            if (d < minStopDist) { minStopDist = d; nextStopNode = node; }
        }

        const pathResult = findShortestPathSync(naiveCurrentNode, nextStopNode, graph, algorithmName);
        finalNaiveRoute.push({
            path: pathResult ? pathResult.path : [naiveCurrentNode, nextStopNode],
            distance: pathResult ? pathResult.distance : getDistanceInKm(naiveCurrentCoord.lat, naiveCurrentCoord.lon, nextStopCoord.lat, nextStopCoord.lon)
        });
        naiveCurrentNode = nextStopNode;
        naiveCurrentCoord = nextStopCoord;
    }
    const finalNaiveReturn = findShortestPathSync(naiveCurrentNode, depotNode, graph, algorithmName);
    finalNaiveRoute.push({
        path: finalNaiveReturn ? finalNaiveReturn.path : [naiveCurrentNode, depotNode],
        distance: finalNaiveReturn ? finalNaiveReturn.distance : getDistanceInKm(naiveCurrentCoord.lat, naiveCurrentCoord.lon, depot.lat, depot.lon)
    });

    const naiveDistance = finalNaiveRoute.reduce((sum, seg) => sum + seg.distance, 0);
    const totalOptimizedDistance = linkingSegments.reduce((sum, seg) => sum + seg.distance, 0);

    const optimizedPoints = [];
    for (const seg of linkingSegments) {
        for (const node of seg.path) {
            optimizedPoints.push([node.longitude ?? node.lon, node.latitude ?? node.lat]);
        }
    }

    const naivePoints = [];
    for (const seg of finalNaiveRoute) {
        for (const node of seg.path) {
            naivePoints.push([node.longitude ?? node.lon, node.latitude ?? node.lat]);
        }
    }

    const crossingsNaive = countCrossings(naivePoints);
    const crossingsOptimized = countCrossings(optimizedPoints);

    const finalResult = {
        optimizedRoute: linkingSegments,
        naiveRoute: finalNaiveRoute,
        stats: {
            naiveDistance: naiveDistance,
            optimizedDistance: totalOptimizedDistance,
            distanceSaved: Math.max(0, naiveDistance - totalOptimizedDistance),
            percentageReduction: Math.max(0, ((naiveDistance - totalOptimizedDistance) / naiveDistance) * 100),
            naiveCrossings: crossingsNaive,
            optimizedCrossings: crossingsOptimized,
            crossingsSaved: Math.max(0, crossingsNaive - crossingsOptimized)
        }
    };

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
