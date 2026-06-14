import fs from 'fs';
import { runComparison } from './src/services/ComparisonService.js';
import Node from './src/models/Node.js';
import Edge from './src/models/Edge.js';
import Graph from './src/models/Graph.js';

// We need to polyfill performance.now()
global.performance = { now: () => Date.now() };

const graph = new Graph();

const n1 = new Node('1', 0, 0);
const n2 = new Node('2', 1, 0);
const n3 = new Node('3', 2, 0);
const n4 = new Node('4', 3, 0);
const n5 = new Node('5', 4, 0);

graph.addNode(n1);
graph.addNode(n2);
graph.addNode(n3);
graph.addNode(n4);
graph.addNode(n5);

graph.addEdge(n1, n2, 1);
graph.addEdge(n2, n3, 1);
graph.addEdge(n3, n4, 1);
graph.addEdge(n4, n5, 1);

(async () => {
    try {
        const results = await runComparison(['bidirectional'], graph, n1, n5);
        console.log(JSON.stringify(results, null, 2));
    } catch (e) {
        console.error("Error:", e);
    }
})();
