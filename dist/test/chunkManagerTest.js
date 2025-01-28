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
Object.defineProperty(exports, "__esModule", { value: true });
const CodeChunkManager_1 = require("../services/CodeChunkManager");
const path = __importStar(require("path"));
async function main() {
    // Initialize the chunk manager
    const manager = new CodeChunkManager_1.CodeChunkManager();
    await manager.initialize();
    // Process the src directory
    const srcDir = path.join(__dirname, '..');
    await manager.processDirectory(srcDir);
    // Example searches
    console.log('\nSearching for "parse"...');
    const parseResults = manager.searchChunks('parse', {
        types: ['function', 'method'],
        maxResults: 5
    });
    console.log('Found matches:', parseResults.length);
    parseResults.forEach(result => {
        console.log(`\nChunk: ${result.chunk.id}`);
        console.log(`Type: ${result.chunk.type}`);
        console.log(`Dependencies: ${result.chunk.dependencies.length}`);
        console.log('Content preview:', result.content.slice(0, 100), '...');
    });
    // Search with dependencies
    console.log('\nSearching for "chunk" with dependencies...');
    const chunkResults = manager.searchChunks('chunk', {
        includeDependencies: true,
        maxResults: 3
    });
    console.log('Found matches (including dependencies):', chunkResults.length);
    chunkResults.forEach(result => {
        console.log(`\nChunk: ${result.chunk.id}`);
        console.log(`Type: ${result.chunk.type}`);
        console.log('Content preview:', result.content.slice(0, 100), '...');
    });
}
main().catch(console.error);
