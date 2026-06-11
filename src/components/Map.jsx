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
import { solveClusteredTsp } from "../services/RoutingService";

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
    const [settings, setSettings] = useState({ algorithm: "astar", radius: 4, speed: 5 });
    const [colors, setColors] = useState(INITIAL_COLORS);
    const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
    const [mapStyle, setMapStyle] = useState(() => {
        const stored = localStorage.getItem("path_map_style");
        return stored || MAP_STYLE;
    });

    // CTSP Routing states
    const [routingMode, setRoutingMode] = useState("single");
    const [deliveryStops, setDeliveryStops] = useState([]);
    const [k, setK] = useState(3);
    const [showNaiveRoute, setShowNaiveRoute] = useState(false);
    const [optimizedRouteData, setOptimizedRouteData] = useState(null);

    const ui = useRef();
    const fadeRadius = useRef();
    const requestRef = useRef();
    const previousTimeRef = useRef();
    const timer = useRef(0);
    const waypoints = useRef([]);
    const state = useRef(new PathfindingState());
    const traceNode = useRef(null);
    const traceNode2 = useRef(null);
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

        const data = solveClusteredTsp(
            { id: startNode.id, lat: startNode.lat, lon: startNode.lon },
            deliveryStops,
            k,
            state.current.graph
        );

        if (!data) {
            ui.current.showSnack("Failed to solve Clustered TSP routing.");
            return;
        }

        setOptimizedRouteData(data);

        let currentTimer = 0;
        const pathWaypoints = [];

        for (const segment of data.optimizedRoute) {
            const segmentType = segment.type; // "connector" or "zone-0", "zone-1", etc.

            for (let i = 0; i < segment.path.length - 1; i++) {
                const node = segment.path[i];
                const nextNode = segment.path[i + 1];
                const distance = Math.hypot(nextNode.longitude - node.longitude, nextNode.latitude - node.latitude);
                const timeAdd = distance * 50000;

                pathWaypoints.push({
                    path: [[node.longitude ?? node.lon, node.latitude ?? node.lat], [nextNode.longitude ?? nextNode.lon, nextNode.latitude ?? nextNode.lat]],
                    timestamps: [currentTimer, currentTimer + timeAdd],
                    color: segmentType
                });

                currentTimer += timeAdd;
            }
        }

        waypoints.current = pathWaypoints;
        timer.current = currentTimer;
        setTripsData(pathWaypoints);
        setStarted(true);
    }

    // Start or pause already running animation
    function toggleAnimation(loop = true, direction = 1) {
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
                        setAnimationEnded(true);
                        setStarted(false);
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

    function changeLocation(location) {
        setViewState({ ...viewState, longitude: location.longitude, latitude: location.latitude, zoom: 13,transitionDuration: 1, transitionInterpolator: new FlyToInterpolator()});
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
                            if (d.color === "connector") return CONNECTOR_COLOR;
                            if (d.color && d.color.startsWith("zone-")) return ZONE_COLORS[d.color] || [255, 255, 255];
                            return colors[d.color] || colors.path;
                        }}
                        updateTriggers={{
                            getColor: [colors.path, colors.route]
                        }}
                    />
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
                                        "zone-0": [0, 150, 136],
                                        "zone-1": [255, 111, 0],
                                        "zone-2": [255, 193, 7],
                                        "zone-3": [156, 39, 176],
                                        "zone-4": [233, 30, 99],
                                        "zone-5": [76, 175, 80],
                                        "zone-6": [33, 150, 243],
                                        "zone-7": [255, 87, 34]
                                    };
                                    let color = [64, 196, 255];
                                    if (optimizedRouteData && stop.clusterId !== undefined) {
                                        color = ZONE_COLORS[`zone-${stop.clusterId}`] || color;
                                    }
                                    return {
                                        coordinates: [stop.lon, stop.lat],
                                        color: color,
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
                            />
                            {/* Text Labels */}
                            <TextLayer
                                id="stop-labels"
                                data={[
                                    ...(startNode ? [{ coordinates: [startNode.lon, startNode.lat], text: "DEPOT", color: [255, 255, 255] }] : []),
                                    ...deliveryStops.map((stop, idx) => {
                                        let label = `D${idx + 1}`;
                                        if (optimizedRouteData && stop.clusterId !== undefined) {
                                            const zoneLetters = ["A", "B", "C", "D", "E", "F", "G", "H"];
                                            const letter = zoneLetters[stop.clusterId] || `${stop.clusterId}`;
                                            const cluster = optimizedRouteData.clusters.find(c => c.id === stop.clusterId);
                                            const stopSubIdx = cluster ? cluster.stops.findIndex(s => s.id === stop.id) + 1 : idx + 1;
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
                deliveryStops={deliveryStops}
                setDeliveryStops={setDeliveryStops}
                k={k}
                setK={setK}
                showNaiveRoute={showNaiveRoute}
                setShowNaiveRoute={setShowNaiveRoute}
                optimizedRouteData={optimizedRouteData}
                setOptimizedRouteData={setOptimizedRouteData}
                solveClusteredTsp={(depot, stops, zones, graph) => {
                    const data = solveClusteredTsp(depot, stops, zones, graph);
                    setOptimizedRouteData(data);
                    return data;
                }}
                graph={state.current.graph}
            />
            <div className="attrib-container"><summary className="maplibregl-ctrl-attrib-button" title="Toggle attribution" aria-label="Toggle attribution"></summary><div className="maplibregl-ctrl-attrib-inner">© <a href="https://carto.com/about-carto/" target="_blank" rel="noopener">CARTO</a>, © <a href="http://www.openstreetmap.org/about/" target="_blank">OpenStreetMap</a> contributors</div></div>
        </>
    );
}

export default Map;