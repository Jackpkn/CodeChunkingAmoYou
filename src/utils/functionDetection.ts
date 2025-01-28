import * as fs from 'fs';
import Parser from 'tree-sitter';
import { CodeConstruct } from '../chunker';
import { CodeGraph } from '../graph';
 


export function detectFunctionCalls(construct: CodeConstruct, graph: CodeGraph): CodeConstruct[] {
    try {
        if (!fs.existsSync(construct.file)) {
            console.warn(`File does not exist: ${construct.file}`);
            return [];
        }

        const fileContent = fs.readFileSync(construct.file, 'utf-8');
        const parser = new Parser();

        let language;
        if (construct.file.endsWith('.js')) {
            const JavaScript = require('tree-sitter-javascript');
            language = JavaScript;
        } else if (construct.file.endsWith('.ts')) {
            const TypeScript = require('tree-sitter-typescript').typescript;
            language = TypeScript;
        } else {
            console.warn(`Unsupported file type: ${construct.file}`);
            return [];
        }

        parser.setLanguage(language);
        const tree = parser.parse(fileContent);

        if (!tree) {
            console.warn(`Failed to parse file: ${construct.file}`);
            return [];
        }

        const functionCalls: CodeConstruct[] = [];

        function visitNode(node: Parser.SyntaxNode) {
            if (node.type === 'call_expression') {
                const functionNameNode = node.childForFieldName('function');
                if (functionNameNode) {
                    const functionName = fileContent.substring(
                        functionNameNode.startIndex,
                        functionNameNode.endIndex
                    );

                    // Check if the function is defined in another file
                    const potentialFiles = graph.getAllFiles().filter(file => fs.existsSync(file));
                    for (const file of potentialFiles) {
                        const constructId = `${file}:${functionName}`;
                        if (graph.hasConstruct(constructId)) {
                            const callExpression: CodeConstruct = {
                                type: 'function_call',
                                name: functionName,
                                file: file,
                                startPosition: node.startPosition,
                                endPosition: node.endPosition,
                                content: fileContent.substring(node.startIndex, node.endIndex)
                            };
                            functionCalls.push(callExpression);
                            break;
                        }
                    }
                }
            }

            for (const child of node.children) {
                visitNode(child);
            }
        }

        visitNode(tree.rootNode);
        return functionCalls;
    } catch (error) {
        console.error(`Error processing file ${construct.file}:`, error);
        return [];
    }
}

export function detectCrossFileFunctionCalls(graph: CodeGraph, constructs: CodeConstruct[]) {
    constructs.forEach(construct => {
        if (construct.type === 'function' || construct.type === 'class_method') {
            const calledFunctions = detectFunctionCalls(construct, graph);
            calledFunctions.forEach(calledFunction => {
                const fromId = `${construct.file}:${construct.name}`;
                const toId = `${calledFunction.file}:${calledFunction.name}`;
                graph.addEdge(fromId, toId);
            });
        }
    });
} 