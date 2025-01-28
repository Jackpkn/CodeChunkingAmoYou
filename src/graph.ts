import { CodeConstruct } from './chunker';

export interface GraphNode {
  id: string;
  construct: CodeConstruct;
  edges: string[]; // IDs of referenced constructs
}

export class CodeGraph {
  private nodes: Map<string, GraphNode> = new Map();

  addConstruct(construct: CodeConstruct) {
    const id = `${construct.file}:${construct.name}`;
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, construct, edges: [] });
    }
  }

  addEdge(fromId: string, toId: string) {
    if (this.nodes.has(fromId) && this.nodes.has(toId)) {
      this.nodes.get(fromId)!.edges.push(toId);
    }
  }

  getGraph(): Map<string, GraphNode> {
    return this.nodes;
  }

  // New method to get all unique files in the graph
  getAllFiles(): string[] {
    const files = new Set<string>();
    for (const node of this.nodes.values()) {
      files.add(node.construct.file);
    }
    return Array.from(files);
  }

  // New method to check if a construct exists in the graph
  hasConstruct(id: string): boolean {
    return this.nodes.has(id);
  }

  // New method to get a construct by ID
  getConstruct(id: string): GraphNode | undefined {
    return this.nodes.get(id);
  }

  // New method to get all constructs from a specific file
  getConstructsInFile(file: string): GraphNode[] {
    return Array.from(this.nodes.values()).filter(
      node => node.construct.file === file
    );
  }

  // New method to get related constructs
  getRelatedConstructs(constructId: string): GraphNode[] {
    const related = new Set<GraphNode>();
    
    // Find edges connected to this construct
    const relatedEdges = Array.from(this.nodes.values()).filter(
      node => node.edges.includes(constructId) || node.id === constructId
    );

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