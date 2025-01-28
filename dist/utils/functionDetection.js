"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.detectFunctionCalls = detectFunctionCalls;
exports.detectCrossFileFunctionCalls = detectCrossFileFunctionCalls;
const fs = __importStar(require("fs"));
const tree_sitter_1 = __importDefault(require("tree-sitter"));
function detectFunctionCalls(construct, graph) {
    try {
        if (!fs.existsSync(construct.file)) {
            console.warn(`File does not exist: ${construct.file}`);
            return [];
        }
        const fileContent = fs.readFileSync(construct.file, 'utf-8');
        const parser = new tree_sitter_1.default();
        let language;
        if (construct.file.endsWith('.js')) {
            const JavaScript = require('tree-sitter-javascript');
            language = JavaScript;
        }
        else if (construct.file.endsWith('.ts')) {
            const TypeScript = require('tree-sitter-typescript').typescript;
            language = TypeScript;
        }
        else {
            console.warn(`Unsupported file type: ${construct.file}`);
            return [];
        }
        parser.setLanguage(language);
        const tree = parser.parse(fileContent);
        if (!tree) {
            console.warn(`Failed to parse file: ${construct.file}`);
            return [];
        }
        const functionCalls = [];
        function visitNode(node) {
            if (node.type === 'call_expression') {
                const functionNameNode = node.childForFieldName('function');
                if (functionNameNode) {
                    const functionName = fileContent.substring(functionNameNode.startIndex, functionNameNode.endIndex);
                    // Check if the function is defined in another file
                    const potentialFiles = graph.getAllFiles().filter(file => fs.existsSync(file));
                    for (const file of potentialFiles) {
                        const constructId = `${file}:${functionName}`;
                        if (graph.hasConstruct(constructId)) {
                            const callExpression = {
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
    }
    catch (error) {
        console.error(`Error processing file ${construct.file}:`, error);
        return [];
    }
}
function detectCrossFileFunctionCalls(graph, constructs) {
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
