import * as fs from 'fs';
import * as path from 'path';
import { CodeGraph } from '../graph';
import { Link } from '../types';
 

export function visualizeGraph(graph: CodeGraph) {
    const nodes = Array.from(graph.getGraph().values()).map(node => ({
        id: node.id,
        name: node.construct.name,
        type: node.construct.type,
        file: node.construct.file
    }));

    const links: Link[] = [];
    graph.getGraph().forEach(node => {
        node.edges.forEach(edge => {
            links.push({ source: node.id, target: edge });
        });
    });

    const outputPath = path.resolve(__dirname, '../graph.json');
    fs.writeFileSync(outputPath, JSON.stringify({ nodes, links }, null, 2));
    console.log(`Graph data saved to ${outputPath}.`);
} 