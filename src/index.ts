import * as path from 'path';
import { ChunkingService } from './services/ChunkingService';
import { logger } from './utils/logger';
import { FolderChunk } from './chunker';

async function main() {
    try {
        // Initialize the chunking service
        const chunkingService = new ChunkingService();
        await chunkingService.initialize('javascript');

        // Process the test directory
        const testDir = path.join(__dirname, '../test');
        logger.info('Processing directory:', testDir);

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
            logger.info('Person class context:', {
                construct: personContext.construct,
                relatedCount: personContext.relatedConstructs.length,
                incomingEdges: personContext.incomingEdges.length,
                outgoingEdges: personContext.outgoingEdges.length
            });
        }

        logger.info('Code chunking completed successfully');
    } catch (error) {
        logger.error('Failed to process codebase:', error);
        process.exit(1);
    }
}

function logFolderStructure(chunks: FolderChunk[], level: number = 0) {
    chunks.forEach(chunk => {
        const indent = '  '.repeat(level);
        logger.info(`${indent}📁 ${chunk.name}`, {
            totalFiles: chunk.metadata?.totalFiles,
            totalConstructs: chunk.metadata?.totalConstructs,
            languages: Array.from(chunk.metadata?.languages || [])
        });

        // Log constructs if at leaf level
        if (chunk.constructs.length > 0) {
            chunk.constructs.forEach(construct => {
                logger.info(`${indent}  📄 ${construct.type}: ${construct.name}`);
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
    logger.error('Unhandled error:', error);
    process.exit(1);
});