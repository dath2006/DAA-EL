import AStar from "../models/algorithms/AStar";
import BidirectionalSearch from "../models/algorithms/BidirectionalSearch";
import Dijkstra from "../models/algorithms/Dijkstra";
import Greedy from "../models/algorithms/Greedy";
import { getDistanceInKm, solveClusteredTsp } from "./RoutingService";
/**
 * Runs a list of algorithms completely on the given graph and returns metrics.
 */
export async function runComparison(algorithms, graph, startNode, endNode) {
    if (!graph || !startNode || !endNode || algorithms.length === 0) return [];

    const results = [];

    // Helper to calculate path distance in KM
    const calcPathDistance = (path) => {
        if (!path || path.length < 2) return 0;
        let distance = 0;
        for (let i = 0; i < path.length - 1; i++) {
            distance += getDistanceInKm(
                path[i].latitude ?? path[i].lat, 
                path[i].longitude ?? path[i].lon, 
                path[i + 1].latitude ?? path[i + 1].lat, 
                path[i + 1].longitude ?? path[i + 1].lon
            );
        }
        return distance;
    };

    for (const algoName of algorithms) {
        // Reset the graph for a clean run
        for (const key of graph.nodes.keys()) {
            graph.nodes.get(key).reset();
        }

        let algo;
        switch (algoName) {
            case "astar": algo = new AStar(); break;
            case "dijkstra": algo = new Dijkstra(); break;
            case "greedy": algo = new Greedy(); break;
            case "bidirectional": algo = new BidirectionalSearch(); break;
            default: algo = new AStar(); break;
        }

        algo.start(startNode, endNode);

        const startTime = performance.now();
        let nodesExplored = 0;
        let finalPath = [];

        // Run until finished
        // We will add a safety break to prevent infinite loops on disconnected graphs
        let safetyCount = 0;
        while (!algo.finished && safetyCount < 500000) {
            const updated = algo.nextStep();
            nodesExplored += updated.length;
            
            // Check if end node was found (algorithm finished internally)
            if (algo.finished) {
                if (algoName !== "bidirectional") {
                    let current = updated.length > 0 ? updated[updated.length - 1] : endNode;
                    // Fallback just in case updated is empty
                    if (current && !current.parent && updated.length > 0) {
                        current = updated[0];
                    }
                    while (current) {
                        finalPath.push(current);
                        current = current.parent;
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
                        // Sometimes prevParent is missing if intersection was exactly at start/end
                        // Try finding any neighbor that goes to the other side
                        if (!currB && intersection.id !== startNode.id && intersection.id !== endNode.id) {
                            const otherNeighbor = intersection.neighbors.find(n => n.node.parent && n.node.parent.id !== pathA[1]?.id);
                            if (otherNeighbor) currB = otherNeighbor.node;
                        }

                        while(currB) { pathB.push(currB); currB = currB.parent; }

                        // Check which path reaches startNode
                        let pathA_reachesStart = pathA.length > 0 && pathA[pathA.length - 1].id === startNode.id;
                        let pathB_reachesStart = pathB.length > 0 && pathB[pathB.length - 1].id === startNode.id;

                        if (pathA_reachesStart) {
                            pathA.reverse();
                            finalPath = [...pathA, ...pathB];
                        } else if (pathB_reachesStart) {
                            pathB.reverse();
                            finalPath = [...pathB, ...pathA];
                        } else {
                            // Fallback
                            finalPath = pathA;
                        }
                    } else {
                        finalPath = []; 
                    }
                }
            }
            safetyCount++;
        }

        const endTime = performance.now();
        const executionTime = endTime - startTime;

        let pathDist = 0;
        console.log(`[ComparisonService] ${algoName} finalPath length:`, finalPath.length);
        if (finalPath.length > 0) {
            pathDist = calcPathDistance(finalPath);
            console.log(`[ComparisonService] ${algoName} pathDist calculated:`, pathDist);
        }

        results.push({
            name: algoName,
            displayName: algoName === "astar" ? "A* Search" : algoName === "dijkstra" ? "Dijkstra" : algoName === "greedy" ? "Greedy Best-First" : "Bidirectional",
            executionTimeMs: executionTime,
            nodesExplored: nodesExplored,
            pathFound: algo.finished,
            pathDistanceKm: pathDist,
            path: finalPath // Added for rendering on map
        });
    }

    // Reset graph again so it's clean for the normal animation
    for (const key of graph.nodes.keys()) {
        graph.nodes.get(key).reset();
    }

    return results;
}

/**
 * Runs Clustered TSP algorithms (NN+2Opt vs Held-Karp) on the given graph and returns metrics.
 */
export async function runClusteredComparison(depot, deliveryStops, k, graph, pathfindingAlgo) {
    if (!depot || deliveryStops.length === 0 || !graph) return [];

    const results = [];
    const algos = [
        { id: "nn_2opt", displayName: "NN + 2-Opt" },
        { id: "held_karp", displayName: "Held-Karp (DP)" }
    ];

    for (const tspAlgo of algos) {
        // Reset the graph for a clean run
        for (const key of graph.nodes.keys()) {
            graph.nodes.get(key).reset();
        }

        const startTime = performance.now();
        const result = solveClusteredTsp(depot, deliveryStops, k, graph, pathfindingAlgo, tspAlgo.id);
        const endTime = performance.now();
        const executionTime = endTime - startTime;

        if (result && result.stats) {
            let finalPath = [];
            if (result.optimizedRoute) {
                finalPath = result.optimizedRoute.flatMap(seg => seg.path);
            }
            results.push({
                name: tspAlgo.id,
                displayName: tspAlgo.displayName,
                executionTimeMs: executionTime,
                distanceKm: result.stats.optimizedDistance,
                crossings: result.stats.optimizedCrossings,
                path: finalPath
            });
        }
    }

    // Reset graph
    for (const key of graph.nodes.keys()) {
        graph.nodes.get(key).reset();
    }

    return results;
}
