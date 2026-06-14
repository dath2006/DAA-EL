import { Button, IconButton, Typography, Snackbar, Alert, CircularProgress, Fade, Tooltip, Drawer, MenuItem, Select, InputLabel, FormControl, Menu, Backdrop, Stepper, Step, StepLabel } from "@mui/material";
import { MuiColorInput } from "mui-color-input";
import { PlayArrow, Settings, Movie, Pause, Replay } from "@mui/icons-material";
import Slider from "./Slider";
import { useState, useEffect, useRef, useImperativeHandle, forwardRef } from "react";
import { INITIAL_COLORS, LOCATIONS } from "../config";
import { arrayToRgb, rgbToArray } from "../helpers";
import { getElbowData, findElbowK } from "../services/RoutingService";
import { runComparison, runClusteredComparison } from "../services/ComparisonService";
import { MdBarChart } from "react-icons/md";

const Interface = forwardRef(({ canStart, started, animationEnded, playbackOn, time, maxTime, settings, colors, loading, timeChanged, cinematic, placeEnd, changeRadius, changeAlgorithm, setPlaceEnd, setCinematic, setSettings, setColors, startPathfinding, toggleAnimation, clearPath, changeLocation, mapStyle, changeMapStyle, routingMode, setRoutingMode, singleRenderMode, setSingleRenderMode, showGraphNodes, setShowGraphNodes, deliveryStops, setDeliveryStops, k, setK, showNaiveRoute, setShowNaiveRoute, optimizedRouteData, setOptimizedRouteData, graph, startNodeObj, endNodeObj, setComparisonPaths, hiddenComparisonPaths, setHiddenComparisonPaths, animationPhase, phaseData, clusterFrame, clusteringDone, currentZoneIdx, zoneNNDone, zoneSwapIdx, advanceToPhase, substepStatus, runNextSubstep }, ref) => {
    const [sidebar, setSidebar] = useState(false);
    const [snack, setSnack] = useState({
        open: false,
        message: "",
        type: "error",
    });
    const [clusteringDoneLocal, setClusteringDoneLocal] = useState(false);

    // Comparison States
    const [showComparisonMenu, setShowComparisonMenu] = useState(false);
    const [selectedComparisonAlgos, setSelectedComparisonAlgos] = useState(["astar", "dijkstra"]);
    const [comparisonResults, setComparisonResults] = useState(null);
    const [isComparing, setIsComparing] = useState(false);

    // Clustered Comparison States
    const [showClusteredComparisonMenu, setShowClusteredComparisonMenu] = useState(false);
    const [isClusteredComparing, setIsClusteredComparing] = useState(false);
    const [clusteredComparisonResults, setClusteredComparisonResults] = useState(null);

    const handleAlgoToggle = (algo, checked) => {
        if (checked) {
            setSelectedComparisonAlgos([...selectedComparisonAlgos, algo]);
        } else {
            setSelectedComparisonAlgos(selectedComparisonAlgos.filter(a => a !== algo));
        }
    };

    const handleRunComparison = async () => {
        if (!graph || !startNodeObj || !endNodeObj) return;
        setIsComparing(true);
        setComparisonResults(null);
        setComparisonPaths([]);
        setHiddenComparisonPaths(new Set());
        setTimeout(async () => {
            const results = await runComparison(selectedComparisonAlgos, graph, startNodeObj, endNodeObj);
            setComparisonResults(results);
            setComparisonPaths(results.filter(r => r.path && r.path.length > 0).map(r => ({
                name: r.name,
                path: r.path.map(node => [node.longitude ?? node.lon, node.latitude ?? node.lat])
            })));
            setIsComparing(false);
        }, 50);
    };

    const handleRunClusteredComparison = async () => {
        if (!graph || !startNodeObj || deliveryStops.length === 0) return;
        setIsClusteredComparing(true);
        setClusteredComparisonResults(null);
        setComparisonPaths([]);
        setHiddenComparisonPaths(new Set());
        setTimeout(async () => {
            const depot = { id: startNodeObj.id, lat: startNodeObj.latitude ?? startNodeObj.lat, lon: startNodeObj.longitude ?? startNodeObj.lon };
            const results = await runClusteredComparison(depot, deliveryStops, k, graph, settings.algorithm);
            setClusteredComparisonResults(results);
            setComparisonPaths(results.filter(r => r.path && r.path.length > 0).map(r => ({
                name: r.name,
                path: r.path.map(node => [node.longitude ?? node.lon, node.latitude ?? node.lat])
            })));
            setIsClusteredComparing(false);
        }, 50);
    };

    const generateDaaInsights = (results) => {
        if (!results || results.length < 2) return "Run at least two algorithms to compare.";
        
        const insights = [];
        const astar = results.find(r => r.name === "astar");
        const dijkstra = results.find(r => r.name === "dijkstra");
        const greedy = results.find(r => r.name === "greedy");
        
        if (astar && dijkstra) {
            const spaceDiff = dijkstra.nodesExplored - astar.nodesExplored;
            if (spaceDiff > 0) {
                insights.push(`Space Complexity: A* pruned the search space using its heuristic, exploring ${spaceDiff} fewer nodes than Dijkstra's exhaustive circle.`);
            }
        }
        
        if (greedy && (astar || dijkstra)) {
            const optimal = astar || dijkstra;
            if (greedy.pathDistanceKm && optimal.pathDistanceKm && greedy.pathDistanceKm > optimal.pathDistanceKm + 0.01) {
                insights.push(`Optimality vs Speed: Greedy found a sub-optimal path (${greedy.pathDistanceKm.toFixed(2)}km vs ${optimal.pathDistanceKm.toFixed(2)}km) but did it by aggressively following its heuristic.`);
            } else if (greedy.nodesExplored < optimal.nodesExplored) {
                insights.push(`Greedy navigated towards the goal very fast (explored only ${greedy.nodesExplored} nodes) and happened to find an optimal path on this specific map topology.`);
            }
        }

        const fastest = [...results].sort((a,b) => a.executionTimeMs - b.executionTimeMs)[0];
        insights.push(`Time Complexity (Real World): ${fastest.displayName} completed fastest in actual execution time (${fastest.executionTimeMs.toFixed(1)}ms).`);

        return insights.map((msg, idx) => <span key={idx} style={{ display: 'block', marginBottom: '8px' }}>{msg}</span>);
    };

    const togglePathVisibility = (algoName) => {
        setHiddenComparisonPaths(prev => {
            const next = new Set(prev);
            if (next.has(algoName)) next.delete(algoName);
            else next.add(algoName);
            return next;
        });
    };

    const generateClusteredDaaInsights = (results) => {
        if (!results || results.length < 2) return "Run comparison to see insights.";
        const insights = [];
        const nn = results.find(r => r.name === "nn_2opt");
        const hk = results.find(r => r.name === "held_karp");

        if (nn && hk) {
            const timeDiffMs = hk.executionTimeMs - nn.executionTimeMs;
            const distDiffKm = nn.distanceKm - hk.distanceKm;

            if (distDiffKm > 0.001) {
                insights.push(`Optimality: Held-Karp found a more optimal route, saving ${distDiffKm.toFixed(2)} km compared to NN + 2-Opt.`);
            } else {
                insights.push(`Optimality: NN + 2-Opt was able to find a route as optimal as Held-Karp's exact solution!`);
            }

            if (timeDiffMs > 0) {
                insights.push(`Time Complexity: Held-Karp's O(n^2 * 2^n) time complexity took ${timeDiffMs.toFixed(2)} ms longer than NN's heuristic O(n^2) approach.`);
            }

            if (nn.crossings > hk.crossings) {
                insights.push(`Crossings: Held-Karp resulted in ${nn.crossings - hk.crossings} fewer path crossings, indicating a visually cleaner route.`);
            }
        }
        return insights.map((msg, idx) => <span key={`cl-ins-${idx}`} style={{ display: 'block', marginBottom: '8px' }}>{msg}</span>);
    };



    const [showTutorial, setShowTutorial] = useState(false);
    const [activeStep, setActiveStep] = useState(0);
    const [helper, setHelper] = useState(false);
    const [menuAnchor, setMenuAnchor] = useState(null);
    const menuOpen = Boolean(menuAnchor);
    const helperTime = useRef(4800);
    const rightDown = useRef(false);
    const leftDown = useRef(false);

    // CTSP Panel States
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState([]);
    const [searchLoading, setSearchLoading] = useState(false);
    const [elbowData, setElbowDataState] = useState([]);
    const [suggestedK, setSuggestedK] = useState(null);

    useEffect(() => {
        if (routingMode === "clustered" && deliveryStops.length >= 2) {
            const data = getElbowData(deliveryStops, Math.min(deliveryStops.length, 8));
            setElbowDataState(data);
            const optimalK = findElbowK(data);
            setSuggestedK(optimalK);
        } else {
            setElbowDataState([]);
            setSuggestedK(null);
        }
    }, [deliveryStops, routingMode]);

    const getNextStepLabel = () => {
        if (!phaseData) return "";
        
        if (animationPhase === 0) {
            return `Start Intra-Zone Optimization (Zone 1 Nearest Neighbor) ›`;
        }
        
        if (animationPhase === 1) {
            const zones = phaseData.phases[1].zones;
            const zone = zones[currentZoneIdx];
            if (!zone) return "";
            const zoneStops = zone.nnSegments.length + 1; // approx stops

            if (!zoneNNDone) {
                if (zone.twoOptSwaps.length > 0) {
                    return `Refine Zone ${currentZoneIdx + 1} with 2-opt (${zone.twoOptSwaps.length} swap${zone.twoOptSwaps.length > 1 ? 's' : ''} found) ›`;
                } else {
                    // 2-opt not possible or no improvement found
                    const nextZone = currentZoneIdx + 1;
                    if (nextZone < zones.length) {
                        return `Zone ${currentZoneIdx + 1}: NN already optimal — Optimize Zone ${nextZone + 1} ›`;
                    } else {
                        return `Zone ${currentZoneIdx + 1}: NN already optimal — Connect Zones ›`;
                    }
                }
            } else {
                const nextSwap = zoneSwapIdx + 1;
                if (nextSwap < zone.twoOptSwaps.length) {
                    return `Apply 2-opt Swap ${nextSwap + 1} of ${zone.twoOptSwaps.length} ›`;
                } else {
                    const nextZone = currentZoneIdx + 1;
                    if (nextZone < zones.length) {
                        return `Zone ${currentZoneIdx + 1} refined — Optimize Zone ${nextZone + 1} ›`;
                    } else {
                        return `All zones refined — Connect Zones ›`;
                    }
                }
            }
        }
        
        if (animationPhase === 2) {
            return "View Full Route Summary ›";
        }
        
        return "";
    };

    const handleSearch = async () => {
        if (!searchQuery) return;
        setSearchLoading(true);
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(searchQuery)}&format=json&limit=5`, {
                headers: { "User-Agent": "Map-Pathfinding-Visualizer-CTSP" }
            });
            const data = await res.json();
            setSearchResults(data);
        } catch (err) {
            setSnack({ open: true, message: "Address search failed.", type: "error" });
        } finally {
            setSearchLoading(false);
        }
    };

    const handleAddSearchedStop = (res) => {
        setSearchResults([]);
        setSearchQuery("");
        const lat = parseFloat(res.lat);
        const lon = parseFloat(res.lon);
        
        if (!graph) {
            // Fly to location
            changeLocation({ latitude: lat, longitude: lon });
            setSnack({ open: true, message: "Location found. Click on the map to place the DEPOT.", type: "info" });
            return;
        }

        // Snap coordinates
        let nearestNode = null;
        let minDist = Infinity;
        for (const node of graph.nodes.values()) {
            const d = Math.pow(node.latitude - lat, 2) + Math.pow(node.longitude - lon, 2);
            if (d < minDist) {
                minDist = d;
                nearestNode = node;
            }
        }

        if (!nearestNode || minDist > 0.01) {
            setSnack({ open: true, message: "Location is too far from the selection radius.", type: "error" });
            return;
        }

        if (deliveryStops.some(s => s.id === nearestNode.id)) {
            setSnack({ open: true, message: "This stop has already been added.", type: "warning" });
            return;
        }

        const newStop = {
            id: nearestNode.id,
            lat: nearestNode.latitude,
            lon: nearestNode.longitude,
            address: res.display_name.split(",").slice(0, 3).join(",")
        };

        setDeliveryStops(prev => [...prev, newStop]);
        setOptimizedRouteData(null);
        clearPath();
    };

    const handleDeleteStop = (idxToDelete) => {
        setDeliveryStops(prev => prev.filter((_, idx) => idx !== idxToDelete));
        setOptimizedRouteData(null);
        clearPath();
    };

    const handleClearAllStops = () => {
        setDeliveryStops([]);
        setOptimizedRouteData(null);
        clearPath();
    };

    // Expose showSnack to parent from ref
    useImperativeHandle(ref, () => ({
        showSnack(message, type = "error") {
            setSnack({ open: true, message, type });
        },
    }));
      
    function closeSnack() {
        setSnack({...snack, open: false});
    }

    function closeHelper() {
        setHelper(false);
    }

    function handleTutorialChange(direction) {
        if(activeStep >= 2 && direction > 0) {
            setShowTutorial(false);
            return;
        }
        
        setActiveStep(Math.max(activeStep + direction, 0));
    }

    // Start pathfinding or toggle playback
    function handlePlay() {
        if(!canStart) return;
        if(!started && time === 0) {
            startPathfinding();
            return;
        }
        toggleAnimation();
    }
    
    function closeMenu() {
        setMenuAnchor(null);
    }

    window.onkeydown = e => {
        if(e.code === "ArrowRight" && !rightDown.current && !leftDown.current && (!started || animationEnded)) {
            rightDown.current = true;
            toggleAnimation(false, 1);
        }
        else if(e.code === "ArrowLeft" && !leftDown.current && !rightDown.current && animationEnded) {
            leftDown.current = true;
            toggleAnimation(false, -1);
        }
    };

    window.onkeyup = e => {
        if(e.code === "Escape") setCinematic(false);
        else if(e.code === "Space") {
            e.preventDefault();
            handlePlay();
        }
        else if(e.code === "ArrowRight" && rightDown.current) {
            rightDown.current = false;
            toggleAnimation(false, 1);
        }
        else if(e.code === "ArrowLeft" && animationEnded && leftDown.current) {
            leftDown.current = false;
            toggleAnimation(false, 1);
        }
        else if(e.code === "KeyR" && (animationEnded || !started)) clearPath();
    };

    // Show cinematic mode helper
    useEffect(() => {
        if(!cinematic) return;
        setHelper(true);
        setTimeout(() => {
            helperTime.current = 2500;
        }, 200);
    }, [cinematic]);

    useEffect(() => {
        if(localStorage.getItem("path_sawtutorial")) return;
        setShowTutorial(true);
        localStorage.setItem("path_sawtutorial", true);
    }, []);

    return (
        <>
            <div className={`nav-top ${cinematic ? "cinematic" : ""}`}>
                <div className="side slider-container">
                    <Typography id="playback-slider" gutterBottom>
                        Animation playback
                    </Typography>
                    <Slider disabled={!animationEnded}  value={animationEnded ? time : maxTime} min={animationEnded ? 0 : -1} max={maxTime} onChange={(e) => {timeChanged(Number(e.target.value));}} className="slider" aria-labelledby="playback-slider" />
                </div>
                <IconButton disabled={!canStart} onClick={handlePlay} style={{ backgroundColor: "#46B780", width: 60, height: 60 }} size="large">
                    {(!started || animationEnded && !playbackOn) 
                        ? <PlayArrow style={{ color: "#fff", width: 26, height: 26 }} fontSize="inherit" />
                        : <Pause style={{ color: "#fff", width: 26, height: 26 }} fontSize="inherit" />
                    }
                </IconButton>
                <div className="side">
                    <Button disabled={!animationEnded && started} onClick={clearPath} style={{ color: "#fff", backgroundColor: "#404156", paddingInline: 30, paddingBlock: 7 }} variant="contained">Clear path</Button>
                </div>
            </div>

            <div className={`nav-right ${cinematic ? "cinematic" : ""}`}>
                <Tooltip title="Open settings">
                    <IconButton onClick={() => {setSidebar(true);}} style={{ backgroundColor: "#2A2B37", width: 36, height: 36 }} size="large">
                        <Settings style={{ color: "#fff", width: 24, height: 24 }} fontSize="inherit" />
                    </IconButton>
                </Tooltip>
                <Tooltip title="Cinematic mode">
                    <IconButton className="btn-cinematic" onClick={() => {setCinematic(!cinematic);}} style={{ backgroundColor: "#2A2B37", width: 36, height: 36 }} size="large">
                        <Movie style={{ color: "#fff", width: 24, height: 24 }} fontSize="inherit" />
                    </IconButton>
                </Tooltip>
            </div>

            <div className="loader-container">
                <Fade
                    in={loading}
                    style={{
                        transitionDelay: loading ? "50ms" : "0ms",
                    }}
                    unmountOnExit
                >
                    <CircularProgress color="inherit" />
                </Fade>
            </div>

            <Snackbar 
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }} 
                open={snack.open} 
                autoHideDuration={4000} 
                onClose={closeSnack}>
                <Alert 
                    onClose={closeSnack} 
                    severity={snack.type} 
                    style={{ width: "100%", color: "#fff" }}
                >
                    {snack.message}
                </Alert>
            </Snackbar>

            <Snackbar 
                anchorOrigin={{ vertical: "top", horizontal: "center" }} 
                open={helper} 
                autoHideDuration={helperTime.current} 
                onClose={closeHelper}
            >
                <div className="cinematic-alert">
                    <Typography fontSize="18px"><b>Cinematic mode</b></Typography>
                    <Typography>Use keyboard shortcuts to control animation</Typography>
                    <Typography>Press <b>Escape</b> to exit</Typography>
                </div>
            </Snackbar>

            <div className="mobile-controls">
                <Button onClick={() => {setPlaceEnd(!placeEnd);}} style={{ color: "#fff", backgroundColor: "#404156", paddingInline: 30, paddingBlock: 7 }} variant="contained">
                    {placeEnd ? "placing end node" : "placing start node"}
                </Button>
            </div>

            {/* Comparison Menu Toggle */}
            {routingMode === "single" && (
                <div className="comparison-toggle" onClick={() => setShowComparisonMenu(true)}>
                    <MdBarChart />
                    <span>Compare</span>
                </div>
            )}
            
            {routingMode === "clustered" && (
                <div className="comparison-toggle" onClick={() => setShowClusteredComparisonMenu(true)}>
                    <MdBarChart />
                    <span>Compare TSP</span>
                </div>
            )}

            {/* Comparison Modal / Panel */}
            {showComparisonMenu && (
                <div className="comparison-panel">
                    <div className="panel-header">
                        <h3>Algorithm Comparison</h3>
                        <i className="material-icons" style={{cursor: "pointer"}} onClick={() => setShowComparisonMenu(false)}>close</i>
                    </div>
                    
                    <div className="panel-body">
                        <div className="algo-selection">
                            <label><input type="checkbox" checked={selectedComparisonAlgos.includes("astar")} onChange={(e) => handleAlgoToggle("astar", e.target.checked)} /> A* Search</label>
                            <label><input type="checkbox" checked={selectedComparisonAlgos.includes("dijkstra")} onChange={(e) => handleAlgoToggle("dijkstra", e.target.checked)} /> Dijkstra</label>
                            <label><input type="checkbox" checked={selectedComparisonAlgos.includes("greedy")} onChange={(e) => handleAlgoToggle("greedy", e.target.checked)} /> Greedy Best-First</label>
                            <label><input type="checkbox" checked={selectedComparisonAlgos.includes("bidirectional")} onChange={(e) => handleAlgoToggle("bidirectional", e.target.checked)} /> Bidirectional</label>
                        </div>
                        
                        <button 
                            className="run-comparison-btn" 
                            disabled={!canStart || selectedComparisonAlgos.length < 2 || isComparing}
                            onClick={handleRunComparison}
                        >
                            {isComparing ? "Running Analysis..." : "Run Analysis"}
                        </button>

                        {comparisonResults && (
                            <div className="comparison-results">
                                <table className="comparison-table">
                                    <thead>
                                        <tr>
                                            <th style={{ textAlign: "left" }}>Algorithm</th>
                                            <th>Time (ms)</th>
                                            <th>Nodes Explored</th>
                                            <th>Distance (km)</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {comparisonResults.map(res => {
                                            const COMPARISON_COLORS = {
                                                "astar": "#FF3C3C",
                                                "dijkstra": "#3C96FF",
                                                "greedy": "#3CFF64",
                                                "bidirectional": "#C83CFF"
                                            };
                                            return (
                                                <tr key={res.name} className={!res.pathFound ? "failed-path" : ""}>
                                                    <td style={{ textAlign: "left", display: "flex", alignItems: "center", gap: "8px" }}>
                                                        <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: COMPARISON_COLORS[res.name] || "#FFF", flexShrink: 0 }} />
                                                        <span style={{ flexGrow: 1 }}>{res.displayName}</span>
                                                        {res.pathFound && (
                                                            <i 
                                                                className="material-icons" 
                                                                style={{ fontSize: "16px", cursor: "pointer", color: hiddenComparisonPaths?.has(res.name) ? "#666" : "#fff", padding: "2px" }}
                                                                onClick={() => togglePathVisibility(res.name)}
                                                                title={hiddenComparisonPaths?.has(res.name) ? "Show Path" : "Hide Path"}
                                                            >
                                                                {hiddenComparisonPaths?.has(res.name) ? "visibility_off" : "visibility"}
                                                            </i>
                                                        )}
                                                    </td>
                                                    <td>{res.executionTimeMs.toFixed(2)}</td>
                                                    <td>{res.nodesExplored}</td>
                                                    <td>{res.pathDistanceKm ? res.pathDistanceKm.toFixed(2) : 'N/A'}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>

                                <div className="daa-insights">
                                    <h4><i className="material-icons">lightbulb</i> DAA Insights</h4>
                                    <div className="insights-content">
                                        {generateDaaInsights(comparisonResults)}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Clustered Comparison Modal / Panel */}
            {showClusteredComparisonMenu && (
                <div className="comparison-panel" style={{ width: "420px" }}>
                    <div className="panel-header">
                        <h3>TSP Algorithm Comparison</h3>
                        <i className="material-icons" style={{cursor: "pointer"}} onClick={() => setShowClusteredComparisonMenu(false)}>close</i>
                    </div>
                    
                    <div className="panel-body">
                        <p style={{ fontSize: '13px', margin: '0 0 15px 0', color: '#ccc' }}>
                            Compares Nearest Neighbor + 2-Opt against the exact Held-Karp algorithm.
                        </p>
                        
                        <button 
                            className="run-comparison-btn" 
                            disabled={!canStart || deliveryStops.length < 1 || isClusteredComparing}
                            onClick={handleRunClusteredComparison}
                        >
                            {isClusteredComparing ? "Running Analysis..." : "Run Analysis"}
                        </button>

                        {clusteredComparisonResults && (
                            <div className="comparison-results">
                                <table className="comparison-table">
                                    <thead>
                                        <tr>
                                            <th style={{ textAlign: "left" }}>Algorithm</th>
                                            <th>Time (ms)</th>
                                            <th>Distance (km)</th>
                                            <th>Crossings</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {clusteredComparisonResults.map(res => {
                                            const COMPARISON_COLORS = {
                                                "nn_2opt": "#3C96FF",
                                                "held_karp": "#FF3C3C"
                                            };
                                            return (
                                                <tr key={res.name}>
                                                    <td style={{ textAlign: "left", display: "flex", alignItems: "center", gap: "8px" }}>
                                                        <div style={{ width: "12px", height: "12px", borderRadius: "50%", background: COMPARISON_COLORS[res.name] || "#FFF", flexShrink: 0 }} />
                                                        <span style={{ flexGrow: 1 }}>{res.displayName}</span>
                                                        <i 
                                                            className="material-icons" 
                                                            style={{ fontSize: "16px", cursor: "pointer", color: hiddenComparisonPaths?.has(res.name) ? "#666" : "#fff", padding: "2px" }}
                                                            onClick={() => togglePathVisibility(res.name)}
                                                            title={hiddenComparisonPaths?.has(res.name) ? "Show Path" : "Hide Path"}
                                                        >
                                                            {hiddenComparisonPaths?.has(res.name) ? "visibility_off" : "visibility"}
                                                        </i>
                                                    </td>
                                                    <td>{res.executionTimeMs.toFixed(2)}</td>
                                                    <td>{res.distanceKm ? res.distanceKm.toFixed(2) : 'N/A'}</td>
                                                    <td>{res.crossings}</td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>

                                <div className="daa-insights">
                                    <h4><i className="material-icons">lightbulb</i> DAA Insights</h4>
                                    <div className="insights-content">
                                        {generateClusteredDaaInsights(clusteredComparisonResults)}
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            <Backdrop
                open={showTutorial}
                onClick={e => {if(e.target.classList.contains("backdrop")) setShowTutorial(false);}}
                className="backdrop"
            >
                <div className="tutorial-container">
                    <Stepper activeStep={activeStep}>
                        <Step>
                            <StepLabel>Basic controls</StepLabel>
                        </Step>
                        <Step>
                            <StepLabel>Playback controls</StepLabel>
                        </Step>
                        <Step>
                            <StepLabel>Changing settings</StepLabel>
                        </Step>
                    </Stepper>
                    <div className="content">
                        <h1>Map Pathfinding Visualizer</h1>
                        {activeStep === 0 && <div>
                            <p>
                                <b>Controls:</b> <br/>
                                <b>Left button:</b> Place start node <br/>
                                <b>Right button:</b> Place end node <br/>
                            </p>
                            <p>The end node must be placed within the shown radius.</p>
                            <video className="video" autoPlay muted loop>
                                <source src="./videos/tutorial1.mp4" type="video/mp4"/>
                            </video>
                        </div>}
                        {activeStep === 1 && <div>
                            <p>
                                To start the visualization, press the <b>Start Button</b> or press <b>Space</b>.<br/>
                                A playback feature is available after the algorithm ends.
                            </p>
                            <video className="video" autoPlay muted loop>
                                <source src="./videos/tutorial2.mp4" type="video/mp4"/>
                            </video>
                        </div>}
                        {activeStep === 2 && <div>
                            <p>
                                You can customize the settings of the animation in the <b>Settings Sidebar</b>. <br/>
                                Try to keep the area radius only as large as you need it to be. <br/>
                                Anything above <b>10km</b> is considered experimental, if you run into performance issues, stop the animation and clear the path.
                            </p>
                            <video className="video" autoPlay muted loop>
                                <source src="./videos/tutorial3.mp4" type="video/mp4"/>
                            </video>
                        </div>}
                    </div>
                    <div className="controls">
                        <Button onClick={() => {setShowTutorial(false);}}
                            className="close" variant="outlined" style={{ borderColor: "#9f9f9f", color: "#9f9f9f", paddingInline: 15 }}
                        >
                            Close
                        </Button>
                        <Button onClick={() => {handleTutorialChange(-1);}}
                            variant="outlined" style={{ borderColor: "#9f9f9f", color: "#9f9f9f", paddingInline: 18 }}
                        >
                                Back
                        </Button>
                        <Button onClick={() => {handleTutorialChange(1);}}
                            variant="contained" style={{ backgroundColor: "#46B780", color: "#fff", paddingInline: 30, fontWeight: "bold" }}
                        >
                            {activeStep >= 2 ? "Finish" : "Next"}
                        </Button>
                    </div>
                </div>
            </Backdrop>

            <Drawer
                className={`side-drawer ${cinematic ? "cinematic" : ""}`}
                anchor="left"
                open={sidebar}
                onClose={() => {setSidebar(false);}}
            >
                <div className="sidebar-container">

                    <FormControl variant="filled">
                        <InputLabel style={{ fontSize: 14 }} id="algo-select">Algorithm</InputLabel>
                        <Select
                            labelId="algo-select"
                            value={settings.algorithm}
                            onChange={e => {changeAlgorithm(e.target.value);}}
                            required
                            style={{ backgroundColor: "#404156", color: "#fff", width: "100%", paddingLeft: 1 }}
                            inputProps={{MenuProps: {MenuListProps: {sx: {backgroundColor: "#404156"}}}}}
                            size="small"
                            disabled={!animationEnded && started}
                        >
                            <MenuItem value={"astar"}>A* algorithm</MenuItem>
                            <MenuItem value={"greedy"}>Greedy algorithm</MenuItem>
                            <MenuItem value={"dijkstra"}>Dijkstra&apos;s algorithm</MenuItem>
                            <MenuItem value={"bidirectional"}>Bidirectional Search algorithm</MenuItem>
                        </Select>
                    </FormControl>
                    {routingMode === "clustered" && (
                        <FormControl variant="filled" style={{ marginTop: "10px", marginBottom: "10px" }}>
                            <InputLabel style={{ fontSize: 14 }} id="tsp-algo-select">TSP Algorithm</InputLabel>
                            <Select
                                labelId="tsp-algo-select"
                                value={settings.tspAlgorithm || "nn_2opt"}
                                onChange={e => {
                                    setSettings({ ...settings, tspAlgorithm: e.target.value });
                                    setOptimizedRouteData(null);
                                    clearPath();
                                }}
                                required
                                style={{ backgroundColor: "#404156", color: "#fff", width: "100%", paddingLeft: 1 }}
                                inputProps={{MenuProps: {MenuListProps: {sx: {backgroundColor: "#404156"}}}}}
                                size="small"
                                disabled={!animationEnded && started}
                            >
                                <MenuItem value={"nn_2opt"}>Nearest Neighbor + 2-Opt (Fast)</MenuItem>
                                <MenuItem value={"held_karp"}>Held-Karp (Optimal, Max 18 stops)</MenuItem>
                            </Select>
                        </FormControl>
                    )}

                    {routingMode === "clustered" && (
                        <div style={{ padding: "8px", backgroundColor: "rgba(0,0,0,0.2)", borderRadius: "4px", fontSize: "12px", color: "#ccc", marginTop: "-10px", marginBottom: "10px" }}>
                            <strong style={{ color: "#fff" }}>Clustered Algorithms in use:</strong><br/>
                            • <em>Clustering:</em> K-Means++<br/>
                            • <em>TSP Method:</em> {settings.tspAlgorithm === 'held_karp' ? 'Held-Karp (Optimal)' : 'Nearest Neighbor + 2-Opt'}<br/>
                            • <em>Pathfinding:</em> {settings.algorithm === 'astar' ? 'A*' : settings.algorithm === 'dijkstra' ? "Dijkstra's" : settings.algorithm === 'greedy' ? 'Greedy' : 'Bidirectional'}
                        </div>
                    )}

                    <FormControl variant="filled">
                        <InputLabel style={{ fontSize: 14 }} id="map-style-select">Map Style</InputLabel>
                        <Select
                            labelId="map-style-select"
                            value={mapStyle}
                            onChange={e => {changeMapStyle(e.target.value);}}
                            required
                            style={{ backgroundColor: "#404156", color: "#fff", width: "100%", paddingLeft: 1 }}
                            inputProps={{MenuProps: {MenuListProps: {sx: {backgroundColor: "#404156"}}}}}
                            size="small"
                        >
                            <MenuItem value={"./map_style.json"}>Sleek Dark Mode</MenuItem>
                            <MenuItem value={"https://basemaps.cartocdn.com/gl/positron-gl-style/style.json"}>Minimal Light Mode</MenuItem>
                            <MenuItem value={"https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json"}>Detailed Streets Mode</MenuItem>
                            <MenuItem value={"https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"}>Dark Matter Mode</MenuItem>
                        </Select>
                    </FormControl>

                    <div>
                        <Button
                            id="locations-button"
                            aria-controls={menuOpen ? "locations-menu" : undefined}
                            aria-haspopup="true"
                            aria-expanded={menuOpen ? "true" : undefined}
                            onClick={(e) => {setMenuAnchor(e.currentTarget);}}
                            variant="contained"
                            disableElevation
                            style={{ backgroundColor: "#404156", color: "#fff", textTransform: "none", fontSize: 16, paddingBlock: 8, justifyContent: "start" }}
                        >
                            Locations
                        </Button>
                        <Menu
                            id="locations-menu"
                            anchorEl={menuAnchor}
                            open={menuOpen}
                            onClose={() => {setMenuAnchor(null);}}
                            MenuListProps={{
                                "aria-labelledby": "locations-button",
                                sx: {
                                    backgroundColor: "#404156"
                                }
                            }}
                            anchorOrigin={{
                                vertical: "top",
                                horizontal: "right",
                            }}
                        >
                            {LOCATIONS.map(location => 
                                <MenuItem key={location.name} onClick={() => {
                                    closeMenu();
                                    changeLocation(location);
                                }}>{location.name}</MenuItem>
                            )}
                        </Menu>
                    </div>

                    <div className="side slider-container">
                        <Typography id="area-slider" >
                            Area radius: {settings.radius}km ({(settings.radius / 1.609).toFixed(1)}mi)
                        </Typography>
                        <Slider disabled={started && !animationEnded} min={2} max={20} step={1} value={settings.radius} onChangeCommited={() => { changeRadius(settings.radius); }} onChange={e => { setSettings({...settings, radius: Number(e.target.value)}); }} className="slider" aria-labelledby="area-slider" style={{ marginBottom: 1 }} 
                            marks={[
                                {
                                    value: 2,
                                    label: "2km"
                                },
                                {
                                    value: 20,
                                    label: "20km"
                                }
                            ]} 
                        />
                    </div>

                    <div className="side slider-container">
                        <Typography id="speed-slider" >
                            Animation speed
                        </Typography>
                        <Slider min={1} max={30} value={settings.speed} onChange={e => { setSettings({...settings, speed: Number(e.target.value)}); }} className="slider" aria-labelledby="speed-slider" style={{ marginBottom: 1 }} />
                    </div>

                    <div className="styles-container">
                        <Typography style={{ color: "#A8AFB3", textTransform: "uppercase", fontSize: 14 }} >
                            Styles
                        </Typography>
                        
                        <div>
                            <Typography id="start-fill-label" >
                                Start node fill color
                            </Typography>
                            <div className="color-container">
                                <MuiColorInput value={arrayToRgb(colors.startNodeFill)} onChange={v => {setColors({...colors, startNodeFill: rgbToArray(v)});}} aria-labelledby="start-fill-label" style={{ backgroundColor: "#404156" }} />
                                <IconButton onClick={() => {setColors({...colors, startNodeFill: INITIAL_COLORS.startNodeFill});}} style={{ backgroundColor: "transparent" }} size="small">
                                    <Replay style={{ color: "#fff", width: 20, height: 20 }} fontSize="inherit" />
                                </IconButton>
                            </div>
                        </div>

                        <div>
                            <Typography id="start-border-label" >
                                Start node border color
                            </Typography>
                            <div className="color-container">
                                <MuiColorInput value={arrayToRgb(colors.startNodeBorder)} onChange={v => {setColors({...colors, startNodeBorder: rgbToArray(v)});}} aria-labelledby="start-border-label" style={{ backgroundColor: "#404156" }} />
                                <IconButton onClick={() => {setColors({...colors, startNodeBorder: INITIAL_COLORS.startNodeBorder});}} style={{ backgroundColor: "transparent" }} size="small">
                                    <Replay style={{ color: "#fff", width: 20, height: 20 }} fontSize="inherit" />
                                </IconButton>
                            </div>
                        </div>

                        <div>
                            <Typography id="end-fill-label" >
                                End node fill color
                            </Typography>
                            <div className="color-container">
                                <MuiColorInput value={arrayToRgb(colors.endNodeFill)} onChange={v => {setColors({...colors, endNodeFill: rgbToArray(v)});}} aria-labelledby="end-fill-label" style={{ backgroundColor: "#404156" }} />
                                <IconButton onClick={() => {setColors({...colors, endNodeFill: INITIAL_COLORS.endNodeFill});}} style={{ backgroundColor: "transparent" }} size="small">
                                    <Replay style={{ color: "#fff", width: 20, height: 20 }} fontSize="inherit" />
                                </IconButton>
                            </div>
                        </div>

                        <div>
                            <Typography id="end-border-label" >
                                End node border color
                            </Typography>
                            <div className="color-container">
                                <MuiColorInput value={arrayToRgb(colors.endNodeBorder)} onChange={v => {setColors({...colors, endNodeBorder: rgbToArray(v)});}} aria-labelledby="end-border-label" style={{ backgroundColor: "#404156" }} />
                                <IconButton onClick={() => {setColors({...colors, endNodeBorder: INITIAL_COLORS.endNodeBorder});}} style={{ backgroundColor: "transparent" }} size="small">
                                    <Replay style={{ color: "#fff", width: 20, height: 20 }} fontSize="inherit" />
                                </IconButton>
                            </div>
                        </div>

                        <div>
                            <Typography id="path-label" >
                                Path color
                            </Typography>
                            <div className="color-container">
                                <MuiColorInput value={arrayToRgb(colors.path)} onChange={v => {setColors({...colors, path: rgbToArray(v)});}} aria-labelledby="path-label" style={{ backgroundColor: "#404156" }} />
                                <IconButton onClick={() => {setColors({...colors, path: INITIAL_COLORS.path});}} style={{ backgroundColor: "transparent" }} size="small">
                                    <Replay style={{ color: "#fff", width: 20, height: 20 }} fontSize="inherit" />
                                </IconButton>
                            </div>
                        </div>

                        <div>
                            <Typography id="route-label" >
                                Shortest route color
                            </Typography>
                            <div className="color-container">
                                <MuiColorInput value={arrayToRgb(colors.route)} onChange={v => {setColors({...colors, route: rgbToArray(v)});}} aria-labelledby="route-label" style={{ backgroundColor: "#404156" }} />
                                <IconButton onClick={() => {setColors({...colors, route: INITIAL_COLORS.route});}} style={{ backgroundColor: "transparent" }} size="small">
                                    <Replay style={{ color: "#fff", width: 20, height: 20 }} fontSize="inherit" />
                                </IconButton>
                            </div>
                        </div>
                    </div>

                    <div className="shortcuts-container">
                        <Typography style={{ color: "#A8AFB3", textTransform: "uppercase", fontSize: 14 }} >
                            Shortcuts
                        </Typography>

                        <div className="shortcut">
                            <p>SPACE</p>
                            <p>Start/Stop animation</p>
                        </div>
                        <div className="shortcut">
                            <p>R</p>
                            <p>Clear path</p>
                        </div>
                        <div className="shortcut">
                            <p>Arrows</p>
                            <p>Animation playback</p>
                        </div>
                        <Button onClick={() => {setActiveStep(0);setShowTutorial(true);}}
                            variant="contained" style={{ backgroundColor: "#404156", color: "#fff" }}
                        >
                            Show tutorial
                        </Button>
                    </div>
                </div>
            </Drawer>

            <a href="https://github.com/honzaap/Pathfinding" aria-label="GitHub repository" target="_blank" className={`github-corner ${cinematic ? "cinematic" : ""}`}>
                <svg width="60" height="60" viewBox="0 0 250 250">
                    <path fill="#2A2B37" d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z"></path><path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" className="octo-arm"></path><path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" className="octo-body"></path>
                </svg>
            </a>

            {/* Mode Toggle Button Group */}
            <div className={`nav-left-top ${cinematic ? "cinematic" : ""}`}>
                <div className="mode-toggle-card">
                    <button 
                        onClick={() => { setRoutingMode("single"); clearPath(); }}
                        className={routingMode === "single" ? "mode-btn active" : "mode-btn"}
                    >
                        Single Route
                    </button>
                    <button 
                        onClick={() => { setRoutingMode("clustered"); clearPath(); }}
                        className={routingMode === "clustered" ? "mode-btn active" : "mode-btn"}
                    >
                        Clustered Delivery
                    </button>
                </div>
                {routingMode === "single" && (
                    <div className="mode-toggle-card" style={{ marginTop: 8 }}>
                        <button 
                            onClick={() => { setSingleRenderMode("lines"); }}
                            className={singleRenderMode === "lines" ? "mode-btn active" : "mode-btn"}
                        >
                            Lines
                        </button>
                        <button 
                            onClick={() => { setSingleRenderMode("points"); }}
                            className={singleRenderMode === "points" ? "mode-btn active" : "mode-btn"}
                        >
                            Points
                        </button>
                    </div>
                )}
                <div className="mode-toggle-card" style={{ marginTop: 8 }}>
                    <button 
                        onClick={() => { setShowGraphNodes(!showGraphNodes); }}
                        className={showGraphNodes ? "mode-btn active" : "mode-btn"}
                    >
                        {showGraphNodes ? "Hide Graph Nodes" : "Show Graph Nodes"}
                    </button>
                </div>
            </div>

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

            {/* Clustered Panel */}
            {routingMode === "clustered" && !cinematic && (
                <div className="clustered-floating-panel">
                    <Typography variant="h6" className="panel-title">
                        Clustered Delivery Routing (CTSP)
                    </Typography>

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
                                    const zones = phaseData.phases[1].zones;
                                    const zone = zones[currentZoneIdx];
                                    if (!zone) return "";
                                    const swaps = zone.twoOptSwaps.length;
                                    const numStops = zone.stopCount ?? (zone.nnSegments.length + 1);

                                    if (zoneNNDone) {
                                        return `Zone ${currentZoneIdx + 1} — 2-opt swap ${zoneSwapIdx + 1}/${swaps}: reversing a sub-tour segment to eliminate crossings and reduce total distance.`;
                                    }

                                    // NN just finished — explain 2-opt availability
                                    if (swaps === 0) {
                                        if (numStops <= 2) {
                                            return `Zone ${currentZoneIdx + 1} has only ${numStops} stop${numStops > 1 ? 's' : ''} — 2-opt requires at least 3 stops to attempt any swap. The Nearest Neighbor tour is already the only possible ordering.`;
                                        }
                                        return `Zone ${currentZoneIdx + 1} — Nearest Neighbor already found the optimal tour! No 2-opt improvements were possible (0 crossings to resolve).`;
                                    }
                                    return `Zone ${currentZoneIdx + 1} — NN path drawn. Found ${swaps} 2-opt improvement${swaps > 1 ? 's' : ''} to apply. Click to start refining.`;
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

                    {/* Next step button */}
                    {phaseData && animationPhase < 3 && substepStatus === "completed" && (
                        <div className="next-step-section" style={{ marginBottom: 12 }}>
                            <button
                                className="next-step-btn primary-glow"
                                onClick={runNextSubstep}
                                style={{
                                    width: "100%",
                                    padding: "10px",
                                    borderRadius: "8px",
                                    border: "none",
                                    background: "#46B780",
                                    color: "#fff",
                                    fontWeight: "bold",
                                    fontSize: "12px",
                                    cursor: "pointer",
                                    boxShadow: "0 0 12px rgba(70, 183, 128, 0.4)",
                                    transition: "all 0.2s"
                                }}
                            >
                                {getNextStepLabel()}
                            </button>
                        </div>
                    )}

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
                    
                    {/* Search Stop */}
                    <div className="search-section">
                        <Typography variant="caption" className="section-label">ADD STOP BY ADDRESS</Typography>
                        <div className="search-bar">
                            <input 
                                type="text" 
                                placeholder="Search location..."
                                value={searchQuery}
                                onChange={e => setSearchQuery(e.target.value)}
                                onKeyDown={e => e.key === "Enter" && handleSearch()}
                            />
                            <Button onClick={handleSearch} disabled={searchLoading}>
                                {searchLoading ? <CircularProgress size={16} /> : "Search"}
                            </Button>
                        </div>
                        {searchResults.length > 0 && (
                            <div className="search-results-dropdown">
                                {searchResults.map((res, idx) => (
                                    <div 
                                        key={idx} 
                                        className="search-result-item"
                                        onClick={() => handleAddSearchedStop(res)}
                                    >
                                        {res.display_name.split(",").slice(0, 3).join(",")}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Stops List */}
                    <div className="stops-section">
                        <div className="section-header">
                            <Typography variant="caption" className="section-label">
                                DELIVERY STOPS ({deliveryStops.length})
                            </Typography>
                            {deliveryStops.length > 0 && (
                                <button onClick={handleClearAllStops} className="clear-btn">Clear All</button>
                            )}
                        </div>
                        {deliveryStops.length === 0 ? (
                            <div className="empty-stops-placeholder">
                                {graph ? "Click inside the selection radius or search above to add stops." : "First place a DEPOT on the map."}
                            </div>
                        ) : (
                            <div className="stops-list">
                                {deliveryStops.map((stop, idx) => (
                                    <div key={stop.id} className="stop-item">
                                        <span className="stop-badge">D{idx + 1}</span>
                                        <span className="stop-address" title={stop.address}>{stop.address}</span>
                                        <button onClick={() => handleDeleteStop(idx)} className="delete-btn">&times;</button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Zone Settings & Elbow chart */}
                    {deliveryStops.length > 0 && (
                        <div className="zones-section">
                            <Typography id="k-slider-label" className="section-label">
                                NUMBER OF ZONES (k): {k}
                            </Typography>
                            <Slider 
                                min={1} 
                                max={Math.max(1, Math.min(deliveryStops.length, 8))} 
                                step={1} 
                                value={k} 
                                onChange={e => {
                                    setK(Number(e.target.value));
                                    clearPath();
                                }}
                                className="slider"
                            />
                            
                            {elbowData.length > 1 && (
                                <div className="elbow-chart-container">
                                    <Typography variant="caption" className="chart-label">
                                        Elbow Curve (Optimal k Recommendation)
                                    </Typography>
                                    <div className="svg-wrapper">
                                        <svg viewBox="0 0 200 80" className="elbow-svg">
                                            <polyline
                                                fill="none"
                                                stroke="#46B780"
                                                strokeWidth="2.5"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                points={elbowData.map((d, idx) => {
                                                    const x = 20 + (idx * (160 / (elbowData.length - 1)));
                                                    const maxWcss = Math.max(...elbowData.map(ed => ed.wcss));
                                                    const minWcss = Math.min(...elbowData.map(ed => ed.wcss));
                                                    const y = 65 - ((d.wcss - minWcss) / (maxWcss - minWcss || 1)) * 50;
                                                    return `${x},${y}`;
                                                }).join(" ")}
                                            />
                                            {elbowData.map((d, idx) => {
                                                const x = 20 + (idx * (160 / (elbowData.length - 1)));
                                                const maxWcss = Math.max(...elbowData.map(ed => ed.wcss));
                                                const minWcss = Math.min(...elbowData.map(ed => ed.wcss));
                                                const y = 65 - ((d.wcss - minWcss) / (maxWcss - minWcss || 1)) * 50;
                                                const isSelected = d.k === k;
                                                return (
                                                    <g key={d.k}>
                                                        <circle 
                                                            cx={x} cy={y} r={isSelected ? 4.5 : 3} 
                                                            fill={isSelected ? "#FFC107" : "#46B780"} 
                                                            className={isSelected ? "selected-node" : ""}
                                                        />
                                                        <text x={x} y={78} fontSize="8" fill="#A8AFB3" textAnchor="middle" fontWeight={isSelected ? "bold" : "normal"}>{d.k}</text>
                                                    </g>
                                                );
                                            })}
                                            {/* Highlight optimal/elbow k */}
                                            {elbowData.map((d, idx) => {
                                                const x = 20 + (idx * (160 / (elbowData.length - 1)));
                                                const maxWcss = Math.max(...elbowData.map(ed => ed.wcss));
                                                const minWcss = Math.min(...elbowData.map(ed => ed.wcss));
                                                const y = 65 - ((d.wcss - minWcss) / (maxWcss - minWcss || 1)) * 50;
                                                if (d.k !== suggestedK) return null;
                                                return (
                                                    <g key={`elbow-${d.k}`}>
                                                        <circle cx={x} cy={y} r={6} fill="none" stroke="#FF6B35" strokeWidth="2" />
                                                        <text x={x} y={y - 8} fontSize="7" fill="#FF6B35" textAnchor="middle" fontWeight="bold">
                                                            optimal
                                                        </text>
                                                    </g>
                                                );
                                            })}
                                        </svg>
                                    </div>
                                    {suggestedK && (
                                        <div className="k-suggestion">
                                            📐 Elbow method suggests <strong>k = {suggestedK}</strong>
                                            {suggestedK !== k && (
                                                <button className="apply-k-btn" onClick={() => setK(suggestedK)}>
                                                    Apply
                                                </button>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Stats Dashboard */}
                    {optimizedRouteData && (
                        <div className="stats-section">
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
                                <Typography variant="caption" className="section-label" style={{ marginBottom: 0 }}>ROUTING METRICS</Typography>
                                <Typography variant="caption" style={{ color: "#46B780", fontWeight: "bold", letterSpacing: "1px" }}>
                                    {settings.algorithm === 'astar' ? 'A* SEARCH' : settings.algorithm === 'dijkstra' ? "DIJKSTRA'S" : settings.algorithm === 'greedy' ? 'GREEDY' : 'BIDIRECTIONAL'}
                                </Typography>
                            </div>
                            
                            <div className="comparison-container">
                                <div className="route-stat naive">
                                    <div className="stat-label">Naive Route</div>
                                    <div className="stat-val">{optimizedRouteData.stats.naiveDistance.toFixed(2)} km</div>
                                    <div className="stat-sub">{optimizedRouteData.stats.naiveCrossings} crossings</div>
                                </div>
                                <div className="route-stat optimized">
                                    <div className="stat-label">Optimized CTSP</div>
                                    <div className="stat-val">{optimizedRouteData.stats.optimizedDistance.toFixed(2)} km</div>
                                    <div className="stat-sub">{optimizedRouteData.stats.optimizedCrossings} crossings</div>
                                </div>
                            </div>

                            <div className="stats-highlight-cards">
                                <div className="highlight-card savings">
                                    <div className="card-label">Distance Saved</div>
                                    <div className="card-val">{optimizedRouteData.stats.distanceSaved.toFixed(2)} km</div>
                                    <div className="card-badge">-{optimizedRouteData.stats.percentageReduction.toFixed(1)}%</div>
                                </div>
                                <div className="highlight-card crossings">
                                    <div className="card-label">Crossings Saved</div>
                                    <div className="card-val">{optimizedRouteData.stats.crossingsSaved}</div>
                                </div>
                            </div>

                            <div className="checkbox-container">
                                <input 
                                    type="checkbox" 
                                    id="show-naive-checkbox"
                                    checked={showNaiveRoute}
                                    onChange={e => setShowNaiveRoute(e.target.checked)}
                                  />
                                  <label htmlFor="show-naive-checkbox">Show Naive Route (Overlay)</label>
                              </div>
                          </div>
                      )}
                  </div>
              )}
        </>
    );
});

Interface.displayName = "Interface";

export default Interface;
