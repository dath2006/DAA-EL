import DeckGL from "@deck.gl/react";
import { Map as MapGL } from "react-map-gl";
import maplibregl from "maplibre-gl";
import { PolygonLayer, ScatterplotLayer, TextLayer, PathLayer } from "@deck.gl/layers";
import { FlyToInterpolator } from "deck.gl";
import { TripsLayer } from "@deck.gl/geo-layers";
import { createGeoJSONCircle } from "../helpers";
import { useEffect, useRef, useState } from "react";
import { getBoundingBoxFromPolygon, getMapGraph, getNearestNode } from "../services/MapService";
import PathfindingState from "../models/PathfindingState";
import Interface from "./Interface";
import { INITIAL_COLORS, INITIAL_VIEW_STATE, MAP_STYLE } from "../config";
import useSmoothStateChange from "../hooks/useSmoothStateChange";
import { solveClusteredTsp, solveClusteredTspStepwise } from "../services/RoutingService";

function getNearestNodeLocal(latitude, longitude, graph) {
    if (!graph || !graph.nodes) return null;
    let nearestNode = null;
    let minDistance = Infinity;

    for (const node of graph.nodes.values()) {
        const distance = Math.pow(node.latitude - latitude, 2) + Math.pow(node.longitude - longitude, 2);
        if (distance < minDistance) {
            minDistance = distance;
            nearestNode = node;
        }
    }
    return nearestNode;
}

function Map() {
    const [startNode, setStartNode] = useState(null);
    const [endNode, setEndNode] = useState(null);
    const [selectionRadius, setSelectionRadius] = useState([]);
    const [tripsData, setTripsData] = useState([]);
    const [started, setStarted] = useState();
    const [time, setTime] = useState(0);
    const [animationEnded, setAnimationEnded] = useState(false);
    const [playbackOn, setPlaybackOn] = useState(false);
    const [playbackDirection, setPlaybackDirection] = useState(1);
    const [fadeRadiusReverse, setFadeRadiusReverse] = useState(false);
    const [cinematic, setCinematic] = useState(false);
    const [placeEnd, setPlaceEnd] = useState(false);
    const [loading, setLoading] = useState(false);
    const [settings, setSettings] = useState({ algorithm: "astar", radius: 4, speed: 5, tspAlgorithm: "nn_2opt" });
    const [colors, setColors] = useState(INITIAL_COLORS);
    const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
    const [mapStyle, setMapStyle] = useState(() => {
        const stored = localStorage.getItem("path_map_style");
        return stored || MAP_STYLE;
    });

    // CTSP Routing states
    const [routingMode, setRoutingMode] = useState("single");
    const [singleRenderMode, setSingleRenderMode] = useState("lines");
    const [showGraphNodes, setShowGraphNodes] = useState(false);
    const [deliveryStops, setDeliveryStops] = useState([]);
    const [k, setK] = useState(3);
    const [showNaiveRoute, setShowNaiveRoute] = useState(false);
    const [optimizedRouteData, setOptimizedRouteData] = useState(null);

    // Comparison paths state
    const [comparisonPaths, setComparisonPaths] = useState([]);
    const [hiddenComparisonPaths, setHiddenComparisonPaths] = useState(new Set());

    // Stepwise animation states
    const [animationPhase, setAnimationPhase] = useState(0); // 0-3
    const [phaseData, setPhaseData]     = useState(null);    // full stepwise result
    const [clusterFrame, setClusterFrame] = useState(0);     // which K-Means iteration
    const [clusteringDone, setClusteringDone] = useState(false);
    const [currentZoneIdx, setCurrentZoneIdx] = useState(0); // which zone is animating in phase 2
    const [zoneNNDone, setZoneNNDone]     = useState(false); // NN drawn, about to show 2-opt
    const [zoneSwapIdx, setZoneSwapIdx]   = useState(0);     // which 2-opt swap
    const [substepStatus, setSubstepStatus] = useState("idle"); // "idle" | "animating" | "completed"

    const ui = useRef();
    const fadeRadius = useRef();
    const requestRef = useRef();
    const previousTimeRef = useRef();
    const timer = useRef(0);
    const waypoints = useRef([]);
    const state = useRef(new PathfindingState());
    const traceNode = useRef(null);
    const traceNode2 = useRef(null);
    const clusterFrameTimer = useRef(null);
    const stepwisePhase = useRef(0);
    const selectionRadiusOpacity = useSmoothStateChange(0, 0, 1, 400, fadeRadius.current, fadeRadiusReverse);

    async function mapClick(e, info, radius = null) {
        if(started && !animationEnded) return;

        setFadeRadiusReverse(false);
        fadeRadius.current = true;

        if (routingMode === "clustered") {
            if (!startNode) {
                // First click sets Depot (equivalently starts graph loading)
                const loadingHandle = setTimeout(() => {
                    setLoading(true);
                }, 300);

                const node = await getNearestNode(e.coordinate[1], e.coordinate[0]);
                if(!node) {
                    ui.current.showSnack("No road node was found in the vicinity, please try another location.");
                    clearTimeout(loadingHandle);
                    setLoading(false);
                    return;
                }

                setStartNode(node);
                setDeliveryStops([]);
                setOptimizedRouteData(null);
                clearPath();

                const circle = createGeoJSONCircle([node.lon, node.lat], radius ?? settings.radius);
                setSelectionRadius([{ contour: circle}]);
                
                getMapGraph(getBoundingBoxFromPolygon(circle), node.id).then(graph => {
                    state.current.graph = graph;
                    clearPath();
                    clearTimeout(loadingHandle);
                    setLoading(false);
                }).catch(err => {
                    clearTimeout(loadingHandle);
                    setLoading(false);
                    ui.current.showSnack("Error loading graph: " + err.message);
                });
            } else {
                // Subsequent clicks inside radius add stops
                if (e.layer?.id !== "selection-radius" && e.layer?.id !== "depot-point" && e.layer?.id !== "delivery-stops" && e.layer?.id !== "stop-labels") {
                    ui.current.showSnack("Please click inside the selection radius to add delivery stops.", "info");
                    return;
                }

                const realNode = getNearestNodeLocal(e.coordinate[1], e.coordinate[0], state.current.graph);
                if (!realNode) {
                    ui.current.showSnack("No road node found in the vicinity. Try clicking closer to a road.");
                    return;
                }

                if (deliveryStops.some(s => s.id === realNode.id)) {
                    ui.current.showSnack("This stop has already been added.", "info");
                    return;
                }

                clearPath();
                setOptimizedRouteData(null);

                const newStop = {
                    id: realNode.id,
                    lat: realNode.latitude,
                    lon: realNode.longitude,
                    address: `Stop #${deliveryStops.length + 1} (${realNode.latitude.toFixed(4)}, ${realNode.longitude.toFixed(4)})`
                };

                setDeliveryStops(prev => [...prev, newStop]);

                fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${realNode.latitude}&lon=${realNode.longitude}`, {
                    headers: { "User-Agent": "Map-Pathfinding-Visualizer-CTSP" }
                })
                    .then(r => r.json())
                    .then(data => {
                        const name = data.display_name ? data.display_name.split(",").slice(0, 3).join(",") : newStop.address;
                        setDeliveryStops(prev => prev.map(s => s.id === realNode.id ? { ...s, address: name } : s));
                    })
                    .catch(() => {});
            }
            return;
        }

        clearPath();

        // Place end node
        if(info.rightButton || placeEnd || (startNode && e.layer?.id === "selection-radius")) {
            if(e.layer?.id !== "selection-radius") {
                ui.current.showSnack("Please select a point inside the radius.", "info");
                return;
            }

            const realEndNode = getNearestNodeLocal(e.coordinate[1], e.coordinate[0], state.current.graph);
            if(!realEndNode) {
                ui.current.showSnack("No path node was found in the vicinity, please try another location.");
                return;
            }

            const node = { id: realEndNode.id, lat: realEndNode.latitude, lon: realEndNode.longitude };
            setEndNode(node);
            state.current.endNode = realEndNode;
            
            return;
        }

        const loadingHandle = setTimeout(() => {
            setLoading(true);
        }, 300);

        // Fectch nearest node
        const node = await getNearestNode(e.coordinate[1], e.coordinate[0]);
        if(!node) {
            ui.current.showSnack("No path was found in the vicinity, please try another location.");
            clearTimeout(loadingHandle);
            setLoading(false);
            return;
        }

        setStartNode(node);
        setEndNode(null);
        const circle = createGeoJSONCircle([node.lon, node.lat], radius ?? settings.radius);
        setSelectionRadius([{ contour: circle}]);
        
        // Fetch nodes inside the radius
        getMapGraph(getBoundingBoxFromPolygon(circle), node.id).then(graph => {
            state.current.graph = graph;
            clearPath();
            clearTimeout(loadingHandle);
            setLoading(false);
        });
    }

    // Start new pathfinding animation
    function startPathfinding() {
        setFadeRadiusReverse(true);
        setTimeout(() => {
            clearPath();
            if (routingMode === "clustered") {
                startClusteredAnimation();
            } else {
                state.current.start(settings.algorithm);
                setStarted(true);
            }
        }, 400);
    }

    function startClusteredAnimation() {
        if (!startNode || deliveryStops.length === 0) return;

        const depot = { id: startNode.id, lat: startNode.latitude ?? startNode.lat, lon: startNode.longitude ?? startNode.lon };
        const result = solveClusteredTspStepwise(depot, deliveryStops, k, state.current.graph, settings.algorithm, settings.tspAlgorithm);

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
        setSubstepStatus("animating");

        // Phase 1: animate K-Means frames with a timer
        animateClusteringPhase(result.phases[0], 0);
    }

    function animateClusteringPhase(clusteringPhase, startFrame = 0) {
        const frames = clusteringPhase.frames;
        let frameIdx = startFrame;
        setClusterFrame(frameIdx);

        // Clear any old timer
        if (clusterFrameTimer.current) clearInterval(clusterFrameTimer.current);

        clusterFrameTimer.current = setInterval(() => {
            frameIdx++;
            setClusterFrame(frameIdx);
            if (frameIdx >= frames.length - 1) {
                clearInterval(clusterFrameTimer.current);
                setClusteringDone(true);
                setSubstepStatus("completed");
                setStarted(false);
            }
        }, 600); // 600ms per K-Means iteration frame
    }

    function advanceToPhase(phaseIdx) {
        // Clear any clustering timers
        if (clusterFrameTimer.current) clearInterval(clusterFrameTimer.current);

        stepwisePhase.current = phaseIdx;
        setAnimationPhase(phaseIdx);

        if (phaseIdx === 0) {
            // Restart clustering phase
            setClusterFrame(0);
            setClusteringDone(false);
            setStarted(true);
            setSubstepStatus("animating");
            if (phaseData) {
                animateClusteringPhase(phaseData.phases[0], 0);
            }
        }
        else if (phaseIdx === 1) {
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
            setSubstepStatus("completed");
            buildSummaryRoute();
        }
    }

    function animateIntrazonePhase(zoneIdx) {
        if (!phaseData) return;
        const zones = phaseData.phases[1].zones;
        if (zoneIdx >= zones.length) {
            advanceToPhase(2);
            return;
        }

        const zone = zones[zoneIdx];
        setCurrentZoneIdx(zoneIdx);
        setZoneNNDone(false);
        setZoneSwapIdx(0);

        // Build and play NN segments for this zone
        buildIntrazoneAnimation(zone.nnSegments, zone.color);
    }

    function buildIntrazoneAnimation(segments, color) {
        // CRITICAL: reset timestamp reference so first frame doesn't get giant deltaTime
        previousTimeRef.current = null;

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

        // If there are no segments (e.g. single-stop zone), instantly complete
        if (currentTimer === 0 || pathWaypoints.length === 0) {
            setTime(0);
            setAnimationEnded(true);
            setStarted(false);
            setSubstepStatus("completed");
            return;
        }

        setSubstepStatus("animating");
        setTime(0);
        setAnimationEnded(false);
        setStarted(true);
    }

    function buildLinkingAnimation(linkingPhase) {
        // CRITICAL: reset timestamp reference so first frame doesn't get giant deltaTime
        previousTimeRef.current = null;

        let currentTimer = 0;
        const pathWaypoints = [];

        for (const seg of linkingPhase.segments) {
            // Determine color: connector = grey, zone-N = zone palette color
            const segColor = seg.type === 'connector' || seg.type === 'return'
                ? 'connector'
                : seg.type; // 'zone-0', 'zone-1', etc.

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
                    color: segColor
                });
                currentTimer += timeAdd;
            }
        }

        waypoints.current = pathWaypoints;
        timer.current = currentTimer;
        setTripsData(pathWaypoints);
        setSubstepStatus("animating");
        setTime(0);
        setAnimationEnded(false);
        setStarted(true);
    }

    function buildSummaryRoute() {
        if (!phaseData || !phaseData.finalResult) return;
        const finalResult = phaseData.finalResult;
        const pathWaypoints = [];

        for (const seg of finalResult.optimizedRoute) {
            for (let i = 0; i < seg.path.length - 1; i++) {
                const node = seg.path[i];
                const nextNode = seg.path[i + 1];
                
                let colorStr = "path";
                if (seg.type === "connector") {
                    colorStr = "connector";
                } else if (seg.type.startsWith("zone-")) {
                    colorStr = seg.type;
                }

                pathWaypoints.push({
                    path: [
                        [node.longitude ?? node.lon, node.latitude ?? node.lat],
                        [nextNode.longitude ?? nextNode.lon, nextNode.latitude ?? nextNode.lat]
                    ],
                    timestamps: [0, 1e9],
                    color: colorStr
                });
            }
        }

        waypoints.current = pathWaypoints;
        timer.current = 1e9;
        setTime(1e9);
        setTripsData(pathWaypoints);
    }

    function runNextSubstep() {
        if (!phaseData) return;

        if (animationPhase === 0 && clusteringDone) {
            // Move to Phase 2, Zone 0 Nearest Neighbor
            setAnimationPhase(1);
            stepwisePhase.current = 1;
            setCurrentZoneIdx(0);
            setZoneNNDone(false);
            setZoneSwapIdx(0);
            
            const zone = phaseData.phases[1].zones[0];
            buildIntrazoneAnimation(zone.nnSegments, zone.color);
            return;
        }

        if (animationPhase === 1) {
            const zones = phaseData.phases[1].zones;
            const zone = zones[currentZoneIdx];

            if (!zoneNNDone) {
                if (zone.twoOptSwaps.length > 0) {
                    // Mark NN done, move to 2-opt swap 0
                    setZoneNNDone(true);
                    setZoneSwapIdx(0);
                    buildIntrazoneAnimation(zone.twoOptSwaps[0].segments, zone.color);
                } else {
                    // No 2-opt swaps for this zone → go to next zone
                    _moveToNextZoneOrLinking(currentZoneIdx + 1);
                }
            } else {
                const nextSwapIdx = zoneSwapIdx + 1;
                if (nextSwapIdx < zone.twoOptSwaps.length) {
                    setZoneSwapIdx(nextSwapIdx);
                    buildIntrazoneAnimation(zone.twoOptSwaps[nextSwapIdx].segments, zone.color);
                } else {
                    // All 2-opt swaps done → go to next zone
                    _moveToNextZoneOrLinking(currentZoneIdx + 1);
                }
            }
            return;
        }

        if (animationPhase === 2) {
            // Move to Phase 4 (Summary)
            setAnimationPhase(3);
            stepwisePhase.current = 3;
            setStarted(false);
            setAnimationEnded(true);
            setSubstepStatus("completed");
            buildSummaryRoute();
            return;
        }
    }

    function _moveToNextZoneOrLinking(nextZoneIdx) {
        const zones = phaseData.phases[1].zones;
        if (nextZoneIdx < zones.length) {
            setCurrentZoneIdx(nextZoneIdx);
            setZoneNNDone(false);
            setZoneSwapIdx(0);
            
            const nextZone = zones[nextZoneIdx];
            buildIntrazoneAnimation(nextZone.nnSegments, nextZone.color);
        } else {
            setAnimationPhase(2);
            stepwisePhase.current = 2;
            buildLinkingAnimation(phaseData.phases[2]);
        }
    }

    function toggleAnimation(loop = true, direction = 1) {
        if (routingMode === "clustered") {
            if (animationPhase === 0) {
                if (started) {
                    setStarted(false);
                    if (clusterFrameTimer.current) clearInterval(clusterFrameTimer.current);
                } else {
                    setStarted(true);
                    if (phaseData) {
                        const currentFrame = clusterFrame >= phaseData.phases[0].frames.length - 1 ? 0 : clusterFrame;
                        animateClusteringPhase(phaseData.phases[0], currentFrame);
                    }
                }
            } else {
                setStarted(!started);
                if (!started) {
                    previousTimeRef.current = null;
                }
            }
            return;
        }

        if(time === 0 && !animationEnded) return;
        setPlaybackDirection(direction);
        if(animationEnded) {
            if(loop && time >= timer.current) {
                setTime(0);
            }
            setStarted(true);
            setPlaybackOn(!playbackOn);
            return;
        }
        setStarted(!started);
        if(started) {
            previousTimeRef.current = null;
        }
    }

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
        setAnimationPhase(0);
        setPhaseData(null);
        setClusterFrame(0);
        setClusteringDone(false);
        setCurrentZoneIdx(0);
        setZoneNNDone(false);
        setZoneSwapIdx(0);
        setSubstepStatus("idle");
        setComparisonPaths([]); // clear comparison paths
        setHiddenComparisonPaths(new Set()); // clear hidden paths
        if (clusterFrameTimer.current) clearInterval(clusterFrameTimer.current);
    }

    // Progress animation by one step
    function animateStep(newTime) {
        if (routingMode === "clustered") {
            if (previousTimeRef.current != null && !animationEnded) {
                const deltaTime = newTime - previousTimeRef.current;
                const timeStep = deltaTime * 0.05 * playbackDirection;
                setTime(prevTime => {
                    const nextTime = prevTime + timeStep;
                    if (nextTime >= timer.current && playbackDirection !== -1) {
                        // Mark animation done and set substepStatus=completed in one batch
                        setAnimationEnded(true);
                        setStarted(false);
                        setSubstepStatus("completed");
                        return timer.current;
                    }
                    return Math.max(0, nextTime);
                });
            }
            if (previousTimeRef.current != null && animationEnded && playbackOn) {
                const deltaTime = newTime - previousTimeRef.current;
                if (time >= timer.current && playbackDirection !== -1) {
                    setPlaybackOn(false);
                }
                setTime(prevTime => (Math.max(Math.min(prevTime + deltaTime * 0.1 * playbackDirection, timer.current), 0)));
            }
            return;
        }

        const updatedNodes = state.current.nextStep();
        for(const updatedNode of updatedNodes) {
            updateWaypoints(updatedNode, updatedNode.referer);
        }

        // Found end but waiting for animation to end
        if(state.current.finished && !animationEnded) {
            // Render route differently for bidirectional
            if(settings.algorithm === "bidirectional") {
                if(!traceNode.current) traceNode.current = updatedNodes[0];
                const parentNode = traceNode.current.parent;
                updateWaypoints(parentNode, traceNode.current, "route", Math.max(Math.log2(settings.speed), 1));
                traceNode.current = parentNode ?? traceNode.current;

                if(!traceNode2.current) {
                    traceNode2.current = updatedNodes[0];
                    traceNode2.current.parent = traceNode2.current.prevParent;
                }
                const parentNode2 = traceNode2.current.parent;
                updateWaypoints(parentNode2, traceNode2.current, "route", Math.max(Math.log2(settings.speed), 1));
                traceNode2.current = parentNode2 ?? traceNode2.current;
                setAnimationEnded(time >= timer.current && parentNode == null && parentNode2 == null);
            }
            else {
                if(!traceNode.current) traceNode.current = state.current.endNode;
                const parentNode = traceNode.current.parent;
                updateWaypoints(parentNode, traceNode.current, "route", Math.max(Math.log2(settings.speed), 1));
                traceNode.current = parentNode ?? traceNode.current;
                setAnimationEnded(time >= timer.current && parentNode == null);
            }
        }

        // Animation progress
        if (previousTimeRef.current != null && !animationEnded) {
            const deltaTime = newTime - previousTimeRef.current;
            setTime(prevTime => (prevTime + deltaTime * playbackDirection));
        }

        // Playback progress
        if(previousTimeRef.current != null && animationEnded && playbackOn) {
            const deltaTime = newTime - previousTimeRef.current;
            if(time >= timer.current && playbackDirection !== -1) {
                setPlaybackOn(false);
            }
            setTime(prevTime => (Math.max(Math.min(prevTime + deltaTime * 2 * playbackDirection, timer.current), 0)));
        }
    }

    // Animation callback
    function animate(newTime) {
        for(let i = 0; i < settings.speed; i++) {
            animateStep(newTime);
        }

        previousTimeRef.current = newTime;
        requestRef.current = requestAnimationFrame(animate);
    }

    // Add new node to the waypoitns property and increment timer
    function updateWaypoints(node, refererNode, color = "path", timeMultiplier = 1) {
        if(!node || !refererNode) return;
        const distance = Math.hypot(node.longitude - refererNode.longitude, node.latitude - refererNode.latitude);
        const timeAdd = distance * 50000 * timeMultiplier;

        waypoints.current = [...waypoints.current,
            { 
                path: [[refererNode.longitude, refererNode.latitude], [node.longitude, node.latitude]],
                timestamps: [timer.current, timer.current + timeAdd],
                color,// timestamp: timer.current + timeAdd
            }
        ];

        timer.current += timeAdd;
        setTripsData(() => waypoints.current);
    }

    function changeSettings(newSettings) {
        setSettings(newSettings);
        const items = { settings: newSettings, colors };
        localStorage.setItem("path_settings", JSON.stringify(items));
    }

    function changeColors(newColors) {
        setColors(newColors);
        const items = { settings, colors: newColors };
        localStorage.setItem("path_settings", JSON.stringify(items));
    }

    function changeAlgorithm(algorithm) {
        clearPath();
        changeSettings({ ...settings, algorithm });
    }

    function changeRadius(radius) {
        changeSettings({...settings, radius});
        if(startNode) {
            setStartNode(null);
            setDeliveryStops([]);
            setOptimizedRouteData(null);
            clearPath();
            mapClick({coordinate: [startNode.lon, startNode.lat]}, {}, radius);
        }
    }

    function changeMapStyle(newStyle) {
        setMapStyle(newStyle);
        localStorage.setItem("path_map_style", newStyle);
    }

    function changeLocation(location) {
        setStartNode(null);
        setEndNode(null);
        setDeliveryStops([]);
        setOptimizedRouteData(null);
        clearPath();
        setViewState({ ...viewState, longitude: location.longitude, latitude: location.latitude, zoom: 13,transitionDuration: 1, transitionInterpolator: new FlyToInterpolator()});
    }

    useEffect(() => {
        // Only auto-compute optimizedRouteData when NOT in an active stepwise animation
        // (phaseData being set means animation is running — skip to avoid extra cluster renders)
        if (routingMode === "clustered" && startNode && deliveryStops.length > 0 && state.current.graph && !phaseData) {
            const depot = { id: startNode.id, lat: startNode.lat, lon: startNode.lon };
            const data = solveClusteredTsp(depot, deliveryStops, k, state.current.graph, settings.algorithm, settings.tspAlgorithm);
            setOptimizedRouteData(data);
        } else if (!phaseData) {
            setOptimizedRouteData(null);
        }
    }, [routingMode, startNode, deliveryStops, k, state.current.graph, phaseData]);

    useEffect(() => {
        if(!started) return;
        requestRef.current = requestAnimationFrame(animate);
        return () => cancelAnimationFrame(requestRef.current);
    }, [started, time, animationEnded, playbackOn]);

    useEffect(() => {
        navigator.geolocation.getCurrentPosition(res => {
            changeLocation(res.coords);
        });

        const settings = localStorage.getItem("path_settings");
        if(!settings) return;
        const items = JSON.parse(settings);

        setSettings(items.settings);
        setColors(items.colors);
    }, []);

    return (
        <>
            <div onContextMenu={(e) => { e.preventDefault(); }}>
                <DeckGL
                    initialViewState={viewState}
                    controller={{ doubleClickZoom: false, keyboard: false }}
                    onClick={mapClick}
                >
                    <PolygonLayer 
                        id={"selection-radius"}
                        data={selectionRadius}
                        pickable={true}
                        stroked={true}
                        getPolygon={d => d.contour}
                        getFillColor={[80, 210, 0, 10]}
                        getLineColor={[9, 142, 46, 175]}
                        getLineWidth={3}
                        opacity={selectionRadiusOpacity}
                    />
                    {routingMode === "clustered" && showNaiveRoute && optimizedRouteData && (
                        <PathLayer
                            id="naive-route"
                            data={[
                                {
                                    path: optimizedRouteData.naiveRoute.flatMap(seg => 
                                        seg.path.map(node => [node.longitude ?? node.lon, node.latitude ?? node.lat])
                                    ),
                                    color: [120, 120, 120, 150]
                                }
                            ]}
                            getPath={d => d.path}
                            getColor={d => d.color}
                            getWidth={3}
                            widthMinPixels={2}
                        />
                    )}
                    {routingMode === "single" && singleRenderMode === "points" ? (
                        <ScatterplotLayer
                            id={"pathfinding-points-layer"}
                            data={tripsData.filter(d => d.timestamps[1] <= time)}
                            getPosition={d => d.path[1]}
                            getFillColor={d => {
                                const ZONE_COLORS = {
                                    "zone-0": [0, 150, 136],
                                    "zone-1": [255, 111, 0],
                                    "zone-2": [255, 193, 7],
                                    "zone-3": [156, 39, 176],
                                    "zone-4": [233, 30, 99],
                                    "zone-5": [76, 175, 80],
                                    "zone-6": [33, 150, 243],
                                    "zone-7": [255, 87, 34]
                                };
                                const CONNECTOR_COLOR = [224, 224, 224];
                                if (Array.isArray(d.color)) return d.color;
                                if (d.color === "connector") return CONNECTOR_COLOR;
                                if (typeof d.color === "string" && d.color.startsWith("zone-")) return ZONE_COLORS[d.color] || [255, 255, 255];
                                return colors[d.color] || colors.path;
                            }}
                            radiusMinPixels={4}
                            radiusMaxPixels={6}
                            opacity={1}
                            updateTriggers={{
                                getFillColor: [colors.path, colors.route]
                            }}
                        />
                    ) : (
                        <TripsLayer
                            id={"pathfinding-layer"}
                            data={tripsData}
                            opacity={1}
                            widthMinPixels={4}
                            widthMaxPixels={6}
                            fadeTrail={false}
                            currentTime={time}
                            getColor={d => {
                                const ZONE_COLORS = {
                                    "zone-0": [0, 150, 136],
                                    "zone-1": [255, 111, 0],
                                    "zone-2": [255, 193, 7],
                                    "zone-3": [156, 39, 176],
                                    "zone-4": [233, 30, 99],
                                    "zone-5": [76, 175, 80],
                                    "zone-6": [33, 150, 243],
                                    "zone-7": [255, 87, 34]
                                };
                                const CONNECTOR_COLOR = [224, 224, 224];
                                if (Array.isArray(d.color)) return d.color;
                                if (d.color === "connector") return CONNECTOR_COLOR;
                                if (typeof d.color === "string" && d.color.startsWith("zone-")) return ZONE_COLORS[d.color] || [255, 255, 255];
                                return colors[d.color] || colors.path;
                            }}
                            updateTriggers={{
                                getColor: [colors.path, colors.route]
                            }}
                        />
                    )}
                    {routingMode === "clustered" ? (
                        <>
                            {/* Depot Point */}
                            {startNode && (
                                <ScatterplotLayer 
                                    id="depot-point"
                                    data={[{ coordinates: [startNode.lon, startNode.lat], color: colors.startNodeFill, lineColor: colors.startNodeBorder }]}
                                    pickable={true}
                                    opacity={1}
                                    stroked={true}
                                    filled={true}
                                    radiusScale={1}
                                    radiusMinPixels={9}
                                    radiusMaxPixels={22}
                                    lineWidthMinPixels={2}
                                    lineWidthMaxPixels={4}
                                    getPosition={d => d.coordinates}
                                    getFillColor={d => d.color}
                                    getLineColor={d => d.lineColor}
                                />
                            )}
                            {/* Delivery Stops */}
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
                                    } else if (optimizedRouteData) {
                                        const assignedCluster = optimizedRouteData.stops?.[idx]?.clusterId;
                                        if (assignedCluster !== undefined && assignedCluster !== -1) {
                                            color = ZONE_COLORS[assignedCluster] || color;
                                        }
                                    }
                                    
                                    return {
                                        coordinates: [stop.lon, stop.lat],
                                        color,
                                        lineColor: [255, 255, 255]
                                    };
                                })}
                                pickable={true}
                                opacity={1}
                                stroked={true}
                                filled={true}
                                radiusScale={1}
                                radiusMinPixels={7}
                                radiusMaxPixels={18}
                                lineWidthMinPixels={1.5}
                                lineWidthMaxPixels={3.5}
                                getPosition={d => d.coordinates}
                                getFillColor={d => d.color}
                                getLineColor={d => d.lineColor}
                                updateTriggers={{ getFillColor: [clusterFrame, animationPhase, optimizedRouteData] }}
                            />
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
                            {/* Text Labels */}
                            <TextLayer
                                id="stop-labels"
                                data={[
                                    ...(startNode ? [{ coordinates: [startNode.lon, startNode.lat], text: "DEPOT", color: [255, 255, 255] }] : []),
                                    ...deliveryStops.map((stop, idx) => {
                                        let label = `D${idx + 1}`;
                                        
                                        let assignedCluster = undefined;
                                        if (animationPhase === 0 && phaseData) {
                                            const frame = phaseData.phases[0].frames[Math.min(clusterFrame, phaseData.phases[0].frames.length - 1)];
                                            assignedCluster = frame?.assignments?.[idx];
                                        } else if (optimizedRouteData) {
                                            assignedCluster = optimizedRouteData.stops?.[idx]?.clusterId;
                                        }

                                        if (assignedCluster !== undefined && assignedCluster !== -1) {
                                            const zoneLetters = ["A", "B", "C", "D", "E", "F", "G", "H"];
                                            const letter = zoneLetters[assignedCluster] || `${assignedCluster}`;
                                            
                                            let stopSubIdx = 1;
                                            if (animationPhase === 0 && phaseData) {
                                                const frame = phaseData.phases[0].frames[Math.min(clusterFrame, phaseData.phases[0].frames.length - 1)];
                                                let subCount = 0;
                                                for (let i = 0; i <= idx; i++) {
                                                    if (frame?.assignments?.[i] === assignedCluster) subCount++;
                                                }
                                                stopSubIdx = subCount;
                                            } else if (optimizedRouteData) {
                                                const cluster = optimizedRouteData.clusters.find(c => c.id === assignedCluster);
                                                stopSubIdx = cluster ? cluster.stops.findIndex(s => s.id === stop.id) + 1 : idx + 1;
                                            }
                                            label = `D${idx + 1} (${letter}${stopSubIdx})`;
                                        }
                                        return {
                                            coordinates: [stop.lon, stop.lat],
                                            text: label,
                                            color: [255, 255, 255]
                                        };
                                    })
                                ]}
                                getPosition={d => d.coordinates}
                                getText={d => d.text}
                                getSize={12}
                                getColor={d => d.color}
                                getTextAnchor="middle"
                                getAlignmentBaseline="bottom"
                                pixelOffset={[0, -12]}
                                updateTriggers={{ getText: [clusterFrame, animationPhase, optimizedRouteData] }}
                            />
                        </>
                    ) : (
                        <ScatterplotLayer 
                            id="start-end-points"
                            data={[
                                ...(startNode ? [{ coordinates: [startNode.lon, startNode.lat], color: colors.startNodeFill, lineColor: colors.startNodeBorder }] : []),
                                ...(endNode ? [{ coordinates: [endNode.lon, endNode.lat], color: colors.endNodeFill, lineColor: colors.endNodeBorder }] : []),
                            ]}
                            pickable={true}
                            opacity={1}
                            stroked={true}
                            filled={true}
                            radiusScale={1}
                            radiusMinPixels={7}
                            radiusMaxPixels={20}
                            lineWidthMinPixels={1}
                            lineWidthMaxPixels={3}
                            getPosition={d => d.coordinates}
                            getFillColor={d => d.color}
                            getLineColor={d => d.lineColor}
                        />
                    )}
                    {showGraphNodes && state.current?.graph?.nodes && (
                        <ScatterplotLayer
                            id="all-graph-nodes"
                            data={Array.from(state.current.graph.nodes.values())}
                            getPosition={d => [d.longitude, d.latitude]}
                            getFillColor={[50, 200, 200, 120]}
                            radiusMinPixels={2}
                            radiusMaxPixels={4}
                            pickable={false}
                        />
                    )}
                    {comparisonPaths && comparisonPaths.length > 0 && (
                        <PathLayer
                            id="comparison-paths"
                            data={comparisonPaths.filter(p => !hiddenComparisonPaths.has(p.name))}
                            pickable={true}
                            widthScale={1}
                            widthMinPixels={3}
                            widthMaxPixels={10}
                            getPath={d => d.path}
                            getColor={d => {
                                const COMPARISON_COLORS = {
                                    "astar": [255, 60, 60, 200],
                                    "dijkstra": [60, 150, 255, 200],
                                    "greedy": [60, 255, 100, 200],
                                    "bidirectional": [200, 60, 255, 200],
                                    "nn_2opt": [60, 150, 255, 200], // blue
                                    "held_karp": [255, 60, 60, 200] // red
                                };
                                return COMPARISON_COLORS[d.name] || [255, 255, 255, 200];
                            }}
                            getWidth={d => {
                                const COMPARISON_WIDTHS = {
                                    "astar": 8,
                                    "dijkstra": 6,
                                    "greedy": 4,
                                    "bidirectional": 10,
                                    "nn_2opt": 8,
                                    "held_karp": 4
                                };
                                return COMPARISON_WIDTHS[d.name] || 4;
                            }}
                        />
                    )}
                    <MapGL 
                        reuseMaps mapLib={maplibregl} 
                        mapStyle={mapStyle} 
                        doubleClickZoom={false}
                    />
                </DeckGL>
            </div>
            <Interface 
                ref={ui}
                canStart={routingMode === "clustered" ? (startNode && deliveryStops.length > 0) : (startNode && endNode)}
                started={started}
                animationEnded={animationEnded}
                playbackOn={playbackOn}
                time={time}
                startPathfinding={startPathfinding}
                toggleAnimation={toggleAnimation}
                clearPath={clearPath}
                timeChanged={setTime}
                changeLocation={changeLocation}
                maxTime={timer.current}
                settings={settings}
                setSettings={changeSettings}
                changeAlgorithm={changeAlgorithm}
                colors={colors}
                setColors={changeColors}
                loading={loading}
                cinematic={cinematic}
                setCinematic={setCinematic}
                placeEnd={placeEnd}
                setPlaceEnd={setPlaceEnd}
                changeRadius={changeRadius}
                mapStyle={mapStyle}
                changeMapStyle={changeMapStyle}

                routingMode={routingMode}
                setRoutingMode={setRoutingMode}
                singleRenderMode={singleRenderMode}
                setSingleRenderMode={setSingleRenderMode}
                showGraphNodes={showGraphNodes}
                setShowGraphNodes={setShowGraphNodes}
                deliveryStops={deliveryStops}
                setDeliveryStops={setDeliveryStops}
                k={k}
                setK={setK}
                showNaiveRoute={showNaiveRoute}
                setShowNaiveRoute={setShowNaiveRoute}
                optimizedRouteData={optimizedRouteData}
                setOptimizedRouteData={setOptimizedRouteData}
                graph={state.current.graph}
                startNodeObj={state.current.startNode}
                endNodeObj={state.current.endNode}
                setComparisonPaths={setComparisonPaths}
                hiddenComparisonPaths={hiddenComparisonPaths}
                setHiddenComparisonPaths={setHiddenComparisonPaths}

                animationPhase={animationPhase}
                phaseData={phaseData}
                clusterFrame={clusterFrame}
                clusteringDone={clusteringDone}
                currentZoneIdx={currentZoneIdx}
                zoneNNDone={zoneNNDone}
                zoneSwapIdx={zoneSwapIdx}
                advanceToPhase={advanceToPhase}
                substepStatus={substepStatus}
                runNextSubstep={runNextSubstep}
            />
            <div className="attrib-container"><summary className="maplibregl-ctrl-attrib-button" title="Toggle attribution" aria-label="Toggle attribution"></summary><div className="maplibregl-ctrl-attrib-inner">© <a href="https://carto.com/about-carto/" target="_blank" rel="noopener">CARTO</a>, © <a href="http://www.openstreetmap.org/about/" target="_blank">OpenStreetMap</a> contributors</div></div>
        </>
    );
}

export default Map;