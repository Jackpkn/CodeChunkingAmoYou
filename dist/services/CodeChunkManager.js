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
exports.CodeChunkManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const ParserService_1 = require("./ParserService");
const logger_1 = require("../utils/logger");
class CodeChunkManager {
    constructor(indexPath = './chunk-index.json') {
        this.chunkIndex = {};
        this.fileWatcher = null;
        this.parser = new ParserService_1.ParserService();
        this.indexPath = indexPath;
        this.loadIndex();
    }
    loadIndex() {
        if (fs.existsSync(this.indexPath)) {
            try {
                this.chunkIndex = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
                logger_1.logger.info(`Loaded ${Object.keys(this.chunkIndex).length} chunks from index`);
            }
            catch (error) {
                logger_1.logger.error('Failed to load chunk index:', error);
                this.chunkIndex = {};
            }
        }
    }
    saveIndex() {
        try {
            fs.writeFileSync(this.indexPath, JSON.stringify(this.chunkIndex, null, 2));
            logger_1.logger.info('Saved chunk index');
        }
        catch (error) {
            logger_1.logger.error('Failed to save chunk index:', error);
        }
    }
    async initialize(language = 'typescript') {
        await this.parser.initialize(language);
    }
    async processDirectory(dirPath) {
        const files = await this.findFiles(dirPath);
        for (const file of files) {
            await this.processFile(file);
        }
        this.saveIndex();
        this.watchForChanges(dirPath);
    }
    async findFiles(dirPath) {
        const files = [];
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory() && !entry.name.startsWith('.')) {
                files.push(...await this.findFiles(fullPath));
            }
            else if (entry.isFile() && this.isValidFile(entry.name)) {
                files.push(fullPath);
            }
        }
        return files;
    }
    isValidFile(filename) {
        const validExtensions = ['.ts', '.js', '.tsx', '.jsx'];
        return validExtensions.includes(path.extname(filename));
    }
    async processFile(filePath) {
        try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const stats = fs.statSync(filePath);
            // Check if file has been modified since last indexing
            const existingChunks = Object.values(this.chunkIndex).filter(chunk => chunk.metadata.file === filePath);
            if (existingChunks.length > 0 &&
                existingChunks[0].metadata.lastModified === stats.mtimeMs) {
                return; // File hasn't changed, skip processing
            }
            // Parse file and extract chunks
            const tree = this.parser.parseFile(filePath, content);
            const constructs = this.parser.extractConstructs(tree.rootNode, filePath, content);
            // Remove old chunks for this file
            Object.keys(this.chunkIndex).forEach(id => {
                if (this.chunkIndex[id].metadata.file === filePath) {
                    delete this.chunkIndex[id];
                }
            });
            // Add new chunks
            for (const construct of constructs) {
                const chunkId = `${filePath}:${construct.type}:${construct.name}`;
                this.chunkIndex[chunkId] = {
                    metadata: {
                        id: chunkId,
                        type: construct.type,
                        file: filePath,
                        dependencies: construct.dependencies || [],
                        lastModified: stats.mtimeMs,
                        ast: construct
                    },
                    content: construct.content
                };
            }
            logger_1.logger.info(`Processed ${constructs.length} chunks in ${filePath}`);
        }
        catch (error) {
            logger_1.logger.error(`Failed to process file ${filePath}:`, error);
        }
    }
    watchForChanges(dirPath) {
        if (this.fileWatcher) {
            this.fileWatcher.close();
        }
        this.fileWatcher = fs.watch(dirPath, { recursive: true }, async (eventType, filename) => {
            if (!filename || !this.isValidFile(filename))
                return;
            const fullPath = path.join(dirPath, filename);
            if (fs.existsSync(fullPath)) {
                logger_1.logger.info(`File changed: ${filename}`);
                await this.processFile(fullPath);
                this.saveIndex();
            }
        });
    }
    searchChunks(query, options = {}) {
        const { types = [], maxResults = 10, includeDependencies = true } = options;
        // First pass: Find directly matching chunks
        const matches = Object.entries(this.chunkIndex)
            .filter(([_, chunk]) => {
            if (types.length > 0 && !types.includes(chunk.metadata.type)) {
                return false;
            }
            // Simple text-based relevance scoring
            const relevanceScore = this.calculateRelevance(query, chunk);
            return relevanceScore > 0;
        })
            .sort((a, b) => this.calculateRelevance(query, b[1]) - this.calculateRelevance(query, a[1]))
            .slice(0, maxResults);
        if (!includeDependencies) {
            return matches.map(([_, chunk]) => ({
                chunk: chunk.metadata,
                content: chunk.content
            }));
        }
        // Second pass: Include dependencies
        const result = new Map();
        for (const [_, chunk] of matches) {
            result.set(chunk.metadata.id, {
                chunk: chunk.metadata,
                content: chunk.content
            });
            // Add dependencies recursively
            this.addDependencies(chunk.metadata.dependencies, result);
        }
        return Array.from(result.values());
    }
    addDependencies(dependencies, result) {
        for (const depId of dependencies) {
            if (result.has(depId) || !this.chunkIndex[depId])
                continue;
            const chunk = this.chunkIndex[depId];
            result.set(depId, {
                chunk: chunk.metadata,
                content: chunk.content
            });
            // Recursively add nested dependencies
            this.addDependencies(chunk.metadata.dependencies, result);
        }
    }
    calculateRelevance(query, chunk) {
        const normalizedQuery = query.toLowerCase();
        const normalizedContent = chunk.content.toLowerCase();
        const normalizedName = chunk.metadata.ast.name.toLowerCase();
        let score = 0;
        // Exact name match gets highest score
        if (normalizedName.includes(normalizedQuery)) {
            score += 10;
        }
        // Content matches
        if (normalizedContent.includes(normalizedQuery)) {
            score += 5;
        }
        // Type-based scoring
        if (chunk.metadata.type === 'function' || chunk.metadata.type === 'class') {
            score += 2;
        }
        return score;
    }
    getChunk(id) {
        return this.chunkIndex[id] ? {
            chunk: this.chunkIndex[id].metadata,
            content: this.chunkIndex[id].content
        } : null;
    }
    clearIndex() {
        this.chunkIndex = {};
        this.saveIndex();
    }
}
exports.CodeChunkManager = CodeChunkManager;
