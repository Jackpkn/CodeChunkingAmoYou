import { CodeChunkManager } from '../services/CodeChunkManager';
import * as path from 'path';

async function main() {
  // Initialize the chunk manager
  const manager = new CodeChunkManager();
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
