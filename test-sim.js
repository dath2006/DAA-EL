import fs from 'fs';

class Node {
    constructor(id) {
        this.id = id;
        this.neighbors = [];
        this.visited = false;
        this.parent = null;
        this.prevParent = null;
    }
}

class Edge {
    constructor(n1, n2) {
        this.n1 = n1;
        this.n2 = n2;
        this.visited = false;
    }
    getOtherNode(n) { return n === this.n1 ? this.n2 : this.n1; }
}

const n1 = new Node('1');
const n2 = new Node('2');
const n3 = new Node('3');
const n4 = new Node('4');
const n5 = new Node('5');

const e1 = new Edge(n1, n2); n1.neighbors.push({node: n2, edge: e1}); n2.neighbors.push({node: n1, edge: e1});
const e2 = new Edge(n2, n3); n2.neighbors.push({node: n3, edge: e2}); n3.neighbors.push({node: n2, edge: e2});
const e3 = new Edge(n3, n4); n3.neighbors.push({node: n4, edge: e3}); n4.neighbors.push({node: n3, edge: e3});
const e4 = new Edge(n4, n5); n4.neighbors.push({node: n5, edge: e4}); n5.neighbors.push({node: n4, edge: e4});

const openSetStart = new Set([n1]);
const openSetEnd = new Set([n5]);
const closedSetStart = new Set();
const closedSetEnd = new Set();

let intersection = null;

function updateNeighbors(node, openSet, closedSet) {
    const updated = [];
    for (const n of node.neighbors) {
        const neighbor = n.node;
        const edge = n.edge;
        if(neighbor.visited && !edge.visited) {
            edge.visited = true;
            neighbor.referer = node;
            updated.push(neighbor);
        }
        if (!closedSet.has(neighbor) && !neighbor.visited) {
            openSet.add(neighbor);
            neighbor.prevParent = neighbor.parent;
            neighbor.parent = node;
            neighbor.referer = node;
        }
    }
    return updated;
}

function getNext(openSet, closedSet) {
    let minNode = null;
    for (const node of openSet) {
        if (!minNode || node.totalDistance < minNode.totalDistance) {
            if (!closedSet.has(node)) {
                minNode = node;
            }
        }
    }
    if (minNode) openSet.delete(minNode);
    return minNode;
}

while (!intersection) {
    const currentStart = getNext(openSetStart, closedSetStart);
    if (currentStart) {
        currentStart.visited = true;
        closedSetStart.add(currentStart);
        if (openSetEnd.has(currentStart)) {
            intersection = currentStart;
            break;
        }
        updateNeighbors(currentStart, openSetStart, closedSetStart);
    }

    const currentEnd = getNext(openSetEnd, closedSetEnd);
    if (currentEnd) {
        currentEnd.visited = true;
        closedSetEnd.add(currentEnd);
        if (openSetStart.has(currentEnd)) {
            intersection = currentEnd;
            break;
        }
        updateNeighbors(currentEnd, openSetEnd, closedSetEnd);
    }
}

console.log("Intersection:", intersection.id);

let pathA = [];
let currA = intersection;
while(currA) { pathA.push(currA); currA = currA.parent; }

let pathB = [];
let currB = intersection.prevParent;
while(currB) { pathB.push(currB); currB = currB.parent; }

console.log("PathA:", pathA.map(n => n.id));
console.log("PathB:", pathB.map(n => n.id));

let pathA_reachesStart = pathA.length > 0 && pathA[pathA.length - 1].id === '1';
let pathB_reachesStart = pathB.length > 0 && pathB[pathB.length - 1].id === '1';

let finalPath = [];
if (pathA_reachesStart) {
    pathA.reverse();
    finalPath = [...pathA, ...pathB];
} else if (pathB_reachesStart) {
    pathB.reverse();
    finalPath = [...pathB, ...pathA];
} else {
    finalPath = pathA;
}

console.log("Final Path:", finalPath.map(n => n.id));
