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
const path = __importStar(require("path"));
const ChunkingService_1 = require("./services/ChunkingService");
const logger_1 = require("./utils/logger");
async function main() {
    try {
        // Initialize the chunking service
        const chunkingService = new ChunkingService_1.ChunkingService();
        await chunkingService.initialize('javascript');
        // Process the test directory
        const testDir = path.join(__dirname, '../test');
        logger_1.logger.info('Processing directory:', testDir);
        await chunkingService.processDirectory(testDir, {
            excludeDirs: ['node_modules', '.git', 'dist'],
            includeExtensions: ['.js', '.ts'],
            parallel: true,
            maxFilesPerChunk: 100 // Adjust based on your needs
        });
        // Get folder-level chunks
        const folderChunks = chunkingService.getFolderChunks();
        // Log folder structure and statistics
        logFolderStructure(folderChunks);
        // Example: Get context for a specific class
        const personClassId = '/home/jackpk/Documents/code_chunking/test/file2.js:Person';
        const personContext = chunkingService.getChunkContext(personClassId);
        if (personContext) {
            logger_1.logger.info('Person class context:', {
                construct: personContext.construct,
                relatedCount: personContext.relatedConstructs.length,
                incomingEdges: personContext.incomingEdges.length,
                outgoingEdges: personContext.outgoingEdges.length
            });
        }
        logger_1.logger.info('Code chunking completed successfully');
    }
    catch (error) {
        logger_1.logger.error('Failed to process codebase:', error);
        process.exit(1);
    }
}
function logFolderStructure(chunks, level = 0) {
    chunks.forEach(chunk => {
        const indent = '  '.repeat(level);
        logger_1.logger.info(`${indent}📁 ${chunk.name}`, {
            totalFiles: chunk.metadata?.totalFiles,
            totalConstructs: chunk.metadata?.totalConstructs,
            languages: Array.from(chunk.metadata?.languages || [])
        });
        // Log constructs if at leaf level
        if (chunk.constructs.length > 0) {
            chunk.constructs.forEach(construct => {
                logger_1.logger.info(`${indent}  📄 ${construct.type}: ${construct.name}`);
            });
        }
        // Recursively log subfolders
        if (chunk.subfolders.length > 0) {
            logFolderStructure(chunk.subfolders, level + 1);
        }
    });
}
// Run the main function
main().catch(error => {
    logger_1.logger.error('Unhandled error:', error);
    process.exit(1);
});
