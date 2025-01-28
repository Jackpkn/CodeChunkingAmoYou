"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ParserService = void 0;
const tree_sitter_1 = __importDefault(require("tree-sitter"));
const logger_1 = require("../utils/logger");
class ParserService {
    constructor() {
        this.parsedTrees = new Map();
        this.parseErrors = [];
        this.parser = new tree_sitter_1.default();
    }
    async initialize(language) {
        try {
            let languageModule;
            switch (language.toLowerCase()) {
                case 'javascript':
                    languageModule = require('tree-sitter-javascript');
                    break;
                case 'typescript':
                    languageModule = require('tree-sitter-typescript').typescript;
                    break;
                case 'python':
                    languageModule = require('tree-sitter-python');
                    break;
                default:
                    throw new Error(`Unsupported language: ${language}`);
            }
            this.parser.setLanguage(languageModule);
        }
        catch (error) {
            logger_1.logger.error(`Failed to initialize parser for ${language}:`, error);
            throw error;
        }
    }
    parseFile(filePath, content) {
        try {
            // Try to reuse existing tree for incremental parsing
            const oldTree = this.parsedTrees.get(filePath);
            const tree = this.parser.parse(content, oldTree);
            this.parsedTrees.set(filePath, tree);
            return tree;
        }
        catch (error) {
            logger_1.logger.error(`Failed to parse file ${filePath}:`, error);
            throw error;
        }
    }
    extractConstructs(node, filePath, content) {
        const constructs = [];
        try {
            this.traverseNode(node, filePath, content, constructs);
        }
        catch (error) {
            logger_1.logger.error(`Failed to extract constructs from ${filePath}:`, error);
            this.addParseError(filePath, node, error);
        }
        return constructs;
    }
    traverseNode(node, filePath, content, constructs, parentConstruct) {
        try {
            const construct = this.processNode(node, filePath, content, parentConstruct);
            if (construct) {
                constructs.push(construct);
                // If this is a container (like class), process its children
                if (this.isContainerNode(node)) {
                    for (let i = 0; i < node.childCount; i++) {
                        const child = node.child(i);
                        if (child) {
                            this.traverseNode(child, filePath, content, constructs, construct);
                        }
                    }
                }
            }
            else {
                // Continue traversing if no construct was created
                for (let i = 0; i < node.childCount; i++) {
                    const child = node.child(i);
                    if (child) {
                        this.traverseNode(child, filePath, content, constructs, parentConstruct);
                    }
                }
            }
        }
        catch (error) {
            logger_1.logger.error(`Failed to traverse node in ${filePath}:`, error);
            this.addParseError(filePath, node, error);
        }
    }
    processNode(node, filePath, content, parentConstruct) {
        const nodeContent = content.slice(node.startIndex, node.endIndex).trim();
        if (!nodeContent)
            return null;
        switch (node.type) {
            case 'class_declaration':
            case 'class':
                return this.createClassConstruct(node, filePath, nodeContent);
            case 'function_declaration':
            case 'function':
                return this.createFunctionConstruct(node, filePath, nodeContent, parentConstruct);
            case 'method_definition':
                return this.createMethodConstruct(node, filePath, nodeContent, parentConstruct);
            case 'variable_declaration':
                return this.createVariableConstruct(node, filePath, nodeContent);
            // Add more node types as needed
            default:
                return null;
        }
    }
    isContainerNode(node) {
        return ['class_declaration', 'class', 'function_declaration', 'function'].includes(node.type);
    }
    createClassConstruct(node, filePath, content) {
        const nameNode = node.childForFieldName('name');
        return {
            type: 'class',
            name: nameNode?.text || 'anonymous',
            file: filePath,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
            content: content,
            id: `${filePath}:${nameNode?.text || 'anonymous'}`,
            dependencies: [],
            metadata: {
                isExported: this.hasExportKeyword(node),
                visibility: this.getVisibility(node),
            }
        };
    }
    createFunctionConstruct(node, filePath, content, parentConstruct) {
        const nameNode = node.childForFieldName('name');
        const name = nameNode?.text || 'anonymous';
        return {
            type: 'function',
            name,
            file: filePath,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
            content,
            id: `${filePath}:${name}`,
            dependencies: parentConstruct ? [parentConstruct.name] : [],
            metadata: {
                isExported: this.hasExportKeyword(node),
                isAsync: node.previousSibling?.type === 'async',
            }
        };
    }
    createMethodConstruct(node, filePath, content, parentConstruct) {
        const nameNode = node.childForFieldName('name');
        const name = nameNode?.text || 'anonymous';
        return {
            type: 'method',
            name,
            file: filePath,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
            content,
            id: `${filePath}:${parentConstruct?.name}.${name}`,
            dependencies: parentConstruct ? [parentConstruct.name] : [],
            metadata: {
                isAsync: node.previousSibling?.type === 'async',
                isStatic: this.hasStaticKeyword(node),
                visibility: this.getMethodVisibility(node)
            }
        };
    }
    createVariableConstruct(node, filePath, content) {
        const declarator = node.descendantsOfType('variable_declarator')[0];
        const name = declarator?.childForFieldName('name')?.text || 'anonymous';
        return {
            type: 'variable',
            name,
            file: filePath,
            startPosition: node.startPosition,
            endPosition: node.endPosition,
            content,
            id: `${filePath}:${name}`,
            metadata: {
                isExported: this.hasExportKeyword(node)
            }
        };
    }
    hasStaticKeyword(node) {
        return node.previousSibling?.type === 'static';
    }
    getMethodVisibility(node) {
        const modifier = node.previousSibling;
        if (!modifier)
            return 'public';
        switch (modifier.type) {
            case 'private':
                return 'private';
            case 'protected':
                return 'protected';
            default:
                return 'public';
        }
    }
    addParseError(filePath, node, error) {
        this.parseErrors.push({
            file: filePath,
            line: node.startPosition.row,
            column: node.startPosition.column,
            message: error.message || 'Unknown error',
            severity: 'error'
        });
    }
    hasExportKeyword(node) {
        const parent = node.parent;
        return parent?.type === 'export_statement';
    }
    getVisibility(node) {
        // Implement visibility detection logic
        return 'public';
    }
    getParseErrors() {
        return this.parseErrors;
    }
    clearParseErrors() {
        this.parseErrors = [];
    }
}
exports.ParserService = ParserService;
