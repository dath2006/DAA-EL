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

/**
 * Synchronous A* pathfinder on the loaded local graph.
 * Find shortest path between two nodes in terms of graph edge weights.
 */
export function findShortestPathSync(startNode, endNode, graph) {
    if (!startNode || !endNode || !graph) return null;
    if (startNode.id === endNode.id) return { distance: 0, path: [startNode] };

    // Reset nodes
    for (const node of graph.nodes.values()) {
        node.visited = false;
        node.distanceFromStart = Infinity;
        node.parent = null;
    }

    startNode.distanceFromStart = 0;
    const openSet = [startNode];
    const openSetIds = new Set([startNode.id]);

    while (openSet.length > 0) {
        // Find node with lowest f-score
        let currentIdx = 0;
        let currentF = openSet[0].distanceFromStart + getDistanceInDegrees(openSet[0], endNode);
        for (let i = 1; i < openSet.length; i++) {
            const f = openSet[i].distanceFromStart + getDistanceInDegrees(openSet[i], endNode);
            if (f < currentF) {
                currentF = f;
                currentIdx = i;
            }
        }

        const current = openSet[currentIdx];
        if (current.id === endNode.id) {
            const path = [];
            let temp = current;
            while (temp) {
                path.push(temp);
                temp = temp.parent;
            }
            path.reverse();

            // Calculate distance in km
            let distanceInKm = 0;
            for (let i = 0; i < path.length - 1; i++) {
                distanceInKm += getDistanceInKm(path[i].latitude, path[i].longitude, path[i + 1].latitude, path[i + 1].longitude);
            }
            return { distance: distanceInKm, path };
        }

        openSet.splice(currentIdx, 1);
        openSetIds.delete(current.id);
        current.visited = true;

        for (const edgeInfo of current.neighbors) {
            const neighbor = edgeInfo.node;
            if (neighbor.visited) continue;

            const tentativeG = current.distanceFromStart + edgeInfo.edge.weight;
            if (tentativeG < neighbor.distanceFromStart) {
                neighbor.parent = current;
                neighbor.distanceFromStart = tentativeG;

                if (!openSetIds.has(neighbor.id)) {
                    openSet.push(neighbor);
                    openSetIds.add(neighbor.id);
                }
            }
        }
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
export function solveClusteredTsp(depot, stops, k, graph) {
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
                const pathResult = findShortestPathSync(stopNodes[i], stopNodes[j], graph);
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
        const tspTourIdxs = solveTspNearestNeighbor2Opt(clusterStops, distMatrix);
        clusterTours.push({
            clusterId: cluster.id,
            stops: tspTourIdxs.map(idx => clusterStops[idx]),
            nodes: tspTourIdxs.map(idx => stopNodes[idx]),
            distMatrix,
            pathMatrix
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
        let connPath = findShortestPathSync(currentExitNode, entryNode, graph);
        
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
            const stopPath = tour.pathMatrix[idx1][idx2] || [tour.nodes[idx1], tour.nodes[idx2]];
            const stopDist = tour.distMatrix[idx1][idx2];

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
    let returnPath = findShortestPathSync(currentExitNode, depotNode, graph);
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

        const pathResult = findShortestPathSync(naiveCurrentNode, nextStopNode, graph);
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
    const finalNaiveReturn = findShortestPathSync(naiveCurrentNode, depotNode, graph);
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
