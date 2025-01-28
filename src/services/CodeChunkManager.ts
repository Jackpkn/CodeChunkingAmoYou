import * as fs from 'fs';
import * as path from 'path';
import { CodeConstruct, ParseError } from '../types/index';
import { ParserService } from './ParserService';
import { logger } from '../utils/logger';

interface ChunkMetadata {
  id: string;
  type: string;
  file: string;
  dependencies: string[];
  lastModified: number;
  ast?: any;
}

interface ChunkIndex {
  [chunkId: string]: {
    metadata: ChunkMetadata;
    content: string;
  };
}

export class CodeChunkManager {
  private parser: ParserService;
  private chunkIndex: ChunkIndex = {};
  private fileWatcher: fs.FSWatcher | null = null;
  private indexPath: string;

  constructor(indexPath: string = './chunk-index.json') {
    this.parser = new ParserService();
    this.indexPath = indexPath;
    this.loadIndex();
  }

  private loadIndex(): void {
    if (fs.existsSync(this.indexPath)) {
      try {
        this.chunkIndex = JSON.parse(fs.readFileSync(this.indexPath, 'utf-8'));
        logger.info(`Loaded ${Object.keys(this.chunkIndex).length} chunks from index`);
      } catch (error) {
        logger.error('Failed to load chunk index:', error);
        this.chunkIndex = {};
      }
    }
  }

  private saveIndex(): void {
    try {
      fs.writeFileSync(this.indexPath, JSON.stringify(this.chunkIndex, null, 2));
      logger.info('Saved chunk index');
    } catch (error) {
      logger.error('Failed to save chunk index:', error);
    }
  }

  public async initialize(language: string = 'typescript'): Promise<void> {
    await this.parser.initialize(language);
  }

  public async processDirectory(dirPath: string): Promise<void> {
    const files = await this.findFiles(dirPath);
    for (const file of files) {
      await this.processFile(file);
    }
    this.saveIndex();
    this.watchForChanges(dirPath);
  }

  private async findFiles(dirPath: string): Promise<string[]> {
    const files: string[] = [];
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...await this.findFiles(fullPath));
      } else if (entry.isFile() && this.isValidFile(entry.name)) {
        files.push(fullPath);
      }
    }
    return files;
  }

  private isValidFile(filename: string): boolean {
    const validExtensions = ['.ts', '.js', '.tsx', '.jsx'];
    return validExtensions.includes(path.extname(filename));
  }

  private async processFile(filePath: string): Promise<void> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const stats = fs.statSync(filePath);
      
      // Check if file has been modified since last indexing
      const existingChunks = Object.values(this.chunkIndex).filter(
        chunk => chunk.metadata.file === filePath
      );
      
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

      logger.info(`Processed ${constructs.length} chunks in ${filePath}`);
    } catch (error) {
      logger.error(`Failed to process file ${filePath}:`, error);
    }
  }

  private watchForChanges(dirPath: string): void {
    if (this.fileWatcher) {
      this.fileWatcher.close();
    }

    this.fileWatcher = fs.watch(
      dirPath,
      { recursive: true },
      async (eventType, filename) => {
        if (!filename || !this.isValidFile(filename)) return;
        
        const fullPath = path.join(dirPath, filename);
        if (fs.existsSync(fullPath)) {
          logger.info(`File changed: ${filename}`);
          await this.processFile(fullPath);
          this.saveIndex();
        }
      }
    );
  }

  public searchChunks(query: string, options: {
    types?: string[];
    maxResults?: number;
    includeDependencies?: boolean;
  } = {}): Array<{ chunk: ChunkMetadata; content: string; }> {
    const {
      types = [],
      maxResults = 10,
      includeDependencies = true
    } = options;

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
      .sort((a, b) => 
        this.calculateRelevance(query, b[1]) - this.calculateRelevance(query, a[1])
      )
      .slice(0, maxResults);

    if (!includeDependencies) {
      return matches.map(([_, chunk]) => ({
        chunk: chunk.metadata,
        content: chunk.content
      }));
    }

    // Second pass: Include dependencies
    const result = new Map<string, { chunk: ChunkMetadata; content: string; }>();
    
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

  private addDependencies(
    dependencies: string[],
    result: Map<string, { chunk: ChunkMetadata; content: string; }>
  ): void {
    for (const depId of dependencies) {
      if (result.has(depId) || !this.chunkIndex[depId]) continue;

      const chunk = this.chunkIndex[depId];
      result.set(depId, {
        chunk: chunk.metadata,
        content: chunk.content
      });

      // Recursively add nested dependencies
      this.addDependencies(chunk.metadata.dependencies, result);
    }
  }

  private calculateRelevance(query: string, chunk: {
    metadata: ChunkMetadata;
    content: string;
  }): number {
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

  public getChunk(id: string): { chunk: ChunkMetadata; content: string; } | null {
    return this.chunkIndex[id] ? {
      chunk: this.chunkIndex[id].metadata,
      content: this.chunkIndex[id].content
    } : null;
  }

  public clearIndex(): void {
    this.chunkIndex = {};
    this.saveIndex();
  }
}
