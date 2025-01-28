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
exports.ChunkingService = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const chunker_1 = require("../chunker");
const ParserService_1 = require("./ParserService");
const logger_1 = require("../utils/logger");
class ChunkingService {
    constructor() {
        this.constructs = new Map();
        this.edges = [];
        this.fileRegistry = new Set();
        this.folderChunks = [];
        this.rootDir = '';
        this.moduleMap = new Map(); // Maps module names to construct IDs
        this.parser = new ParserService_1.ParserService();
    }
    async initialize(language = 'typescript') {
        try {
            await this.parser.initialize(language);
        }
        catch (error) {
            logger_1.logger.error('Failed to initialize ChunkingService:', error);
            throw error;
        }
    }
    async processDirectory(dirPath, options = {}) {
        const defaultOptions = {
            excludeDirs: ['node_modules', '.git', 'dist', 'build'],
            includeExtensions: ['.ts', '.tsx', '.js', '.jsx'],
            maxDepth: 10,
            parallel: true,
            maxFilesPerChunk: 100,
            chunkingStrategy: 'hybrid',
            maxEdgesPerConstruct: 50
        };
        options = { ...defaultOptions, ...options };
        try {
            this.rootDir = dirPath;
            const files = await this.findFiles(dirPath, options);
            // Process in batches to manage memory
            const batchSize = 100;
            for (let i = 0; i < files.length; i += batchSize) {
                const batch = files.slice(i, i + batchSize);
                if (options.parallel) {
                    await Promise.all(batch.map(file => this.processFile(file)));
                }
                else {
                    for (const file of batch) {
                        await this.processFile(file);
                    }
                }
                // Build edges for this batch
                await this.buildEdgesForConstructs(Array.from(this.constructs.values()).slice(-batch.length), options.maxEdgesPerConstruct);
                logger_1.logger.debug(`Processed batch ${i / batchSize + 1}/${Math.ceil(files.length / batchSize)}`, {
                    filesInBatch: batch.length,
                    totalConstructs: this.constructs.size,
                    totalEdges: this.edges.length
                });
            }
            // Create chunks based on strategy
            switch (options.chunkingStrategy) {
                case 'module':
                    this.createModuleChunks(options.maxFilesPerChunk);
                    break;
                case 'hybrid':
                    this.createHybridChunks(options.maxFilesPerChunk);
                    break;
                default:
                    this.folderChunks = (0, chunker_1.createFolderChunks)(this.rootDir, Array.from(this.constructs.values()), options.maxFilesPerChunk);
            }
            // Log processing summary
            logger_1.logger.info('Processing complete', {
                totalFiles: files.length,
                totalConstructs: this.constructs.size,
                totalEdges: this.edges.length,
                folderChunks: this.countChunks(this.folderChunks),
                averageChunkSize: this.calculateAverageChunkSize(),
                memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + 'MB'
            });
        }
        catch (error) {
            logger_1.logger.error(`Failed to process directory ${dirPath}:`, error);
            throw error;
        }
    }
    async buildEdgesForConstructs(constructs, maxEdgesPerConstruct) {
        for (const construct of constructs) {
            const newEdges = this.detectEdges(construct);
            // Keep only the strongest edges if we exceed the limit
            if (newEdges.length > maxEdgesPerConstruct) {
                newEdges.sort((a, b) => b.weight - a.weight);
                newEdges.length = maxEdgesPerConstruct;
            }
            this.edges.push(...newEdges);
        }
    }
    createModuleChunks(maxSize) {
        // Group by modules (e.g., by import relationships)
        const moduleChunks = [];
        this.moduleMap.forEach((constructIds, moduleName) => {
            const constructs = Array.from(constructIds)
                .map(id => this.constructs.get(id))
                .filter((c) => c !== undefined);
            if (constructs.length > maxSize) {
                // Split large modules into sub-chunks
                for (let i = 0; i < constructs.length; i += maxSize) {
                    const subConstructs = constructs.slice(i, i + maxSize);
                    moduleChunks.push({
                        path: path.join(this.rootDir, moduleName, `part${i / maxSize + 1}`),
                        name: `${moduleName}_part${i / maxSize + 1}`,
                        constructs: subConstructs,
                        subfolders: [],
                        metadata: {
                            totalFiles: subConstructs.length,
                            totalConstructs: subConstructs.length,
                            languages: new Set(subConstructs.map(c => path.extname(c.file))),
                            lastModified: new Date()
                        }
                    });
                }
            }
            else {
                moduleChunks.push({
                    path: path.join(this.rootDir, moduleName),
                    name: moduleName,
                    constructs,
                    subfolders: [],
                    metadata: {
                        totalFiles: constructs.length,
                        totalConstructs: constructs.length,
                        languages: new Set(constructs.map(c => path.extname(c.file))),
                        lastModified: new Date()
                    }
                });
            }
        });
        this.folderChunks = moduleChunks;
    }
    createHybridChunks(maxSize) {
        // First create folder-based chunks
        this.folderChunks = (0, chunker_1.createFolderChunks)(this.rootDir, Array.from(this.constructs.values()), maxSize);
        // Then enhance with module information
        this.moduleMap.forEach((constructIds, moduleName) => {
            const moduleConstructs = Array.from(constructIds)
                .map(id => this.constructs.get(id))
                .filter((c) => c !== undefined);
            // Add module-based edges
            moduleConstructs.forEach(construct => {
                moduleConstructs.forEach(other => {
                    if (construct.id !== other.id) {
                        this.edges.push({
                            type: 'defines',
                            from: construct.id,
                            to: other.id,
                            weight: 0.75 // Higher weight than same_folder
                        });
                    }
                });
            });
        });
    }
    countChunks(chunks) {
        return chunks.reduce((count, chunk) => count + 1 + this.countChunks(chunk.subfolders), 0);
    }
    calculateAverageChunkSize() {
        const sizes = [];
        const collectSizes = (chunks) => {
            chunks.forEach(chunk => {
                sizes.push(chunk.constructs.length);
                collectSizes(chunk.subfolders);
            });
        };
        collectSizes(this.folderChunks);
        return sizes.length > 0
            ? sizes.reduce((sum, size) => sum + size, 0) / sizes.length
            : 0;
    }
    getFolderChunks() {
        return this.folderChunks;
    }
    getChunkByPath(folderPath) {
        const findChunk = (chunks) => {
            for (const chunk of chunks) {
                if (chunk.path === folderPath)
                    return chunk;
                const found = findChunk(chunk.subfolders);
                if (found)
                    return found;
            }
            return null;
        };
        return findChunk(this.folderChunks);
    }
    async findFiles(dirPath, options) {
        try {
            const files = [];
            const entries = fs.readdirSync(dirPath, { withFileTypes: true });
            for (const entry of entries) {
                const fullPath = path.join(dirPath, entry.name);
                const relativeDepth = path.relative(this.rootDir, fullPath).split(path.sep).length;
                if (options.maxDepth && relativeDepth > options.maxDepth) {
                    continue;
                }
                if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name, options)) {
                    files.push(...await this.findFiles(fullPath, options));
                }
                else if (entry.isFile() && this.isValidFile(entry.name, options)) {
                    files.push(fullPath);
                }
            }
            return files;
        }
        catch (error) {
            logger_1.logger.error(`Failed to find files in ${dirPath}:`, error);
            throw error;
        }
    }
    shouldSkipDirectory(dirname, options) {
        const skipDirs = new Set([
            'node_modules', '.git', 'dist', 'build', 'coverage',
            ...(options.excludeDirs || [])
        ]);
        return skipDirs.has(dirname);
    }
    isValidFile(filename, options) {
        const validExtensions = new Set([
            '.ts', '.tsx', '.js', '.jsx',
            ...(options.includeExtensions || [])
        ]);
        return validExtensions.has(path.extname(filename));
    }
    async processFile(filePath) {
        try {
            if (this.fileRegistry.has(filePath)) {
                logger_1.logger.debug(`File ${filePath} already processed, skipping`);
                return;
            }
            const content = fs.readFileSync(filePath, 'utf-8');
            const tree = this.parser.parseFile(filePath, content);
            const constructs = this.parser.extractConstructs(tree.rootNode, filePath, content);
            // Register constructs
            constructs.forEach(construct => {
                if (construct.id) {
                    this.constructs.set(construct.id, construct);
                }
            });
            this.fileRegistry.add(filePath);
        }
        catch (error) {
            logger_1.logger.error(`Failed to process file ${filePath}:`, error);
            throw error;
        }
    }
    async buildEdges() {
        try {
            this.edges = [];
            for (const construct of this.constructs.values()) {
                const newEdges = this.detectEdges(construct);
                this.edges.push(...newEdges);
            }
        }
        catch (error) {
            logger_1.logger.error('Failed to build edges:', error);
            throw error;
        }
    }
    detectEdges(construct) {
        const edges = [];
        // Handle dependencies
        construct.dependencies?.forEach((dep) => {
            edges.push({
                type: 'uses',
                from: construct.id,
                to: dep,
                weight: 1
            });
        });
        // Add folder-based edges
        const folderChunk = this.getChunkByPath(path.dirname(construct.file));
        if (folderChunk) {
            folderChunk.constructs.forEach((other) => {
                if (other.id !== construct.id) {
                    edges.push({
                        type: 'same_folder',
                        from: construct.id,
                        to: other.id,
                        weight: 0.5
                    });
                }
            });
        }
        return edges;
    }
    getChunkContext(constructId) {
        const construct = this.constructs.get(constructId);
        if (!construct)
            return null;
        const incomingEdges = this.edges.filter(edge => edge.to === constructId);
        const outgoingEdges = this.edges.filter(edge => edge.from === constructId);
        const relatedConstructs = new Set();
        [...incomingEdges, ...outgoingEdges].forEach(edge => {
            const relatedId = edge.from === constructId ? edge.to : edge.from;
            const related = this.constructs.get(relatedId);
            if (related)
                relatedConstructs.add(related);
        });
        return {
            construct,
            incomingEdges,
            outgoingEdges,
            relatedConstructs: Array.from(relatedConstructs)
        };
    }
    getParseErrors() {
        return this.parser.getParseErrors();
    }
    clearCache() {
        this.constructs.clear();
        this.edges = [];
        this.fileRegistry.clear();
        this.folderChunks = [];
        this.parser.clearParseErrors();
    }
}
exports.ChunkingService = ChunkingService;
