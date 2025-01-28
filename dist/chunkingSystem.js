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
exports.ChunkingSystem = void 0;
const crypto = __importStar(require("crypto"));
const fs = __importStar(require("fs"));
const graph_1 = require("./graph");
class ChunkingSystem {
    constructor(cachePath = './chunk-cache.json') {
        this.store = {};
        this.cachePath = cachePath;
        this.graph = new graph_1.CodeGraph();
        this.loadCache();
    }
    loadCache() {
        if (fs.existsSync(this.cachePath)) {
            this.store = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
        }
    }
    saveCache() {
        fs.writeFileSync(this.cachePath, JSON.stringify(this.store, null, 2));
    }
    getFileHash(filePath) {
        const content = fs.readFileSync(filePath, 'utf-8');
        return crypto.createHash('md5').update(content).digest('hex');
    }
    shouldReprocessFile(filePath) {
        if (!fs.existsSync(filePath))
            return false;
        const currentHash = this.getFileHash(filePath);
        const metadata = this.store[filePath];
        return !metadata || metadata.fileHash !== currentHash;
    }
    async processFile(filePath) {
        if (!this.shouldReprocessFile(filePath)) {
            console.log(`Skipping ${filePath} - no changes detected`);
            return;
        }
        const fileHash = this.getFileHash(filePath);
        const lastModified = fs.statSync(filePath).mtimeMs;
        // Your existing chunk processing logic here
        // This should use your tree-sitter parsing and chunk extraction
        // Save to cache
        this.store[filePath] = {
            fileHash,
            lastModified,
            chunks: [], // Add your chunks here
        };
        this.saveCache();
    }
    async generateEmbeddings(chunks) {
        // TODO: Implement embedding generation
        // This could use OpenAI's API or any other embedding service
        return [];
    }
    findSimilarChunks(query, topK = 5) {
        // TODO: Implement similarity search
        // 1. Generate query embedding
        // 2. Compare with cached embeddings
        // 3. Return top K matches
    }
    getRelevantContext(chunk) {
        // Get related chunks based on dependencies
        const related = this.graph.getRelatedConstructs(chunk.id || '');
        return {
            chunk,
            related,
            dependencies: chunk.dependencies || [],
        };
    }
}
exports.ChunkingSystem = ChunkingSystem;
