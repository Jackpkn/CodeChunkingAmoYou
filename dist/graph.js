"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CodeGraph = void 0;
class CodeGraph {
    constructor() {
        this.nodes = new Map();
    }
    addConstruct(construct) {
        const id = `${construct.file}:${construct.name}`;
        if (!this.nodes.has(id)) {
            this.nodes.set(id, { id, construct, edges: [] });
        }
    }
    addEdge(fromId, toId) {
        if (this.nodes.has(fromId) && this.nodes.has(toId)) {
            this.nodes.get(fromId).edges.push(toId);
        }
    }
    getGraph() {
        return this.nodes;
    }
    // New method to get all unique files in the graph
    getAllFiles() {
        const files = new Set();
        for (const node of this.nodes.values()) {
            files.add(node.construct.file);
        }
        return Array.from(files);
    }
    // New method to check if a construct exists in the graph
    hasConstruct(id) {
        return this.nodes.has(id);
    }
    // New method to get a construct by ID
    getConstruct(id) {
        return this.nodes.get(id);
    }
    // New method to get all constructs from a specific file
    getConstructsInFile(file) {
        return Array.from(this.nodes.values()).filter(node => node.construct.file === file);
    }
    // New method to get related constructs
    getRelatedConstructs(constructId) {
        const related = new Set();
        // Find edges connected to this construct
        const relatedEdges = Array.from(this.nodes.values()).filter(node => node.edges.includes(constructId) || node.id === constructId);
        // Get constructs from related edges
        for (const node of relatedEdges) {
            if (node.id !== constructId) {
                related.add(node);
            }
        }
        // Also include constructs from the same file
        const construct = this.getConstruct(constructId);
        if (construct) {
            for (const node of this.nodes.values()) {
                if (node.construct.file === construct.construct.file && node.id !== constructId) {
                    related.add(node);
                }
            }
        }
        return Array.from(related);
    }
}
exports.CodeGraph = CodeGraph;
