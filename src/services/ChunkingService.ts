import * as fs from 'fs';
import * as path from 'path';
import { CodeConstruct, Edge, ChunkContext, ParseError } from '../types/index';
import { FolderChunk, createFolderChunks } from '../chunker';
import { ParserService } from './ParserService';
import { logger } from '../utils/logger';

export interface ProcessOptions {
  excludeDirs?: string[];
  includeExtensions?: string[];
  maxDepth?: number;
  parallel?: boolean;
  maxFilesPerChunk?: number;
  chunkingStrategy?: 'folder' | 'module' | 'hybrid';
  maxEdgesPerConstruct?: number;
}

export class ChunkingService {
  private parser: ParserService;
  private constructs: Map<string, CodeConstruct> = new Map();
  private edges: Edge[] = [];
  private fileRegistry: Set<string> = new Set();
  private folderChunks: FolderChunk[] = [];
  private rootDir: string = '';
  private moduleMap: Map<string, Set<string>> = new Map(); // Maps module names to construct IDs

  constructor() {
    this.parser = new ParserService();
  }

  public async initialize(language: string = 'typescript'): Promise<void> {
    try {
      await this.parser.initialize(language);
    } catch (error) {
      logger.error('Failed to initialize ChunkingService:', error);
      throw error;
    }
  }

  public async processDirectory(dirPath: string, options: ProcessOptions = {}): Promise<void> {
    const defaultOptions: ProcessOptions = {
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
        } else {
          for (const file of batch) {
            await this.processFile(file);
          }
        }

        // Build edges for this batch
        await this.buildEdgesForConstructs(
          Array.from(this.constructs.values()).slice(-batch.length),
          options.maxEdgesPerConstruct!
        );

        logger.debug(`Processed batch ${i/batchSize + 1}/${Math.ceil(files.length/batchSize)}`, {
          filesInBatch: batch.length,
          totalConstructs: this.constructs.size,
          totalEdges: this.edges.length
        });
      }

      // Create chunks based on strategy
      switch (options.chunkingStrategy) {
        case 'module':
          this.createModuleChunks(options.maxFilesPerChunk!);
          break;
        case 'hybrid':
          this.createHybridChunks(options.maxFilesPerChunk!);
          break;
        default:
          this.folderChunks = createFolderChunks(
            this.rootDir,
            Array.from(this.constructs.values()),
            options.maxFilesPerChunk
          );
      }

      // Log processing summary
      logger.info('Processing complete', {
        totalFiles: files.length,
        totalConstructs: this.constructs.size,
        totalEdges: this.edges.length,
        folderChunks: this.countChunks(this.folderChunks),
        averageChunkSize: this.calculateAverageChunkSize(),
        memoryUsage: process.memoryUsage().heapUsed / 1024 / 1024 + 'MB'
      });
    } catch (error) {
      logger.error(`Failed to process directory ${dirPath}:`, error);
      throw error;
    }
  }

  private async buildEdgesForConstructs(constructs: CodeConstruct[], maxEdgesPerConstruct: number): Promise<void> {
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

  private createModuleChunks(maxSize: number): void {
    // Group by modules (e.g., by import relationships)
    const moduleChunks: FolderChunk[] = [];
    this.moduleMap.forEach((constructIds, moduleName) => {
      const constructs = Array.from(constructIds)
        .map(id => this.constructs.get(id))
        .filter((c): c is CodeConstruct => c !== undefined);

      if (constructs.length > maxSize) {
        // Split large modules into sub-chunks
        for (let i = 0; i < constructs.length; i += maxSize) {
          const subConstructs = constructs.slice(i, i + maxSize);
          moduleChunks.push({
            path: path.join(this.rootDir, moduleName, `part${i/maxSize + 1}`),
            name: `${moduleName}_part${i/maxSize + 1}`,
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
      } else {
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

  private createHybridChunks(maxSize: number): void {
    // First create folder-based chunks
    this.folderChunks = createFolderChunks(
      this.rootDir,
      Array.from(this.constructs.values()),
      maxSize
    );

    // Then enhance with module information
    this.moduleMap.forEach((constructIds, moduleName) => {
      const moduleConstructs = Array.from(constructIds)
        .map(id => this.constructs.get(id))
        .filter((c): c is CodeConstruct => c !== undefined);

      // Add module-based edges
      moduleConstructs.forEach(construct => {
        moduleConstructs.forEach(other => {
          if (construct.id !== other.id) {
            this.edges.push({
              type: 'defines',
              from: construct.id!,
              to: other.id!,
              weight: 0.75 // Higher weight than same_folder
            });
          }
        });
      });
    });
  }

  private countChunks(chunks: FolderChunk[]): number {
    return chunks.reduce((count, chunk) =>
      count + 1 + this.countChunks(chunk.subfolders), 0);
  }

  private calculateAverageChunkSize(): number {
    const sizes: number[] = [];
    const collectSizes = (chunks: FolderChunk[]) => {
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

  public getFolderChunks(): FolderChunk[] {
    return this.folderChunks;
  }

  public getChunkByPath(folderPath: string): FolderChunk | null {
    const findChunk = (chunks: FolderChunk[]): FolderChunk | null => {
      for (const chunk of chunks) {
        if (chunk.path === folderPath) return chunk;
        const found = findChunk(chunk.subfolders);
        if (found) return found;
      }
      return null;
    };

    return findChunk(this.folderChunks);
  }

  private async findFiles(
    dirPath: string,
    options: ProcessOptions
  ): Promise<string[]> {
    try {
      const files: string[] = [];
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name);
        const relativeDepth = path.relative(this.rootDir, fullPath).split(path.sep).length;

        if (options.maxDepth && relativeDepth > options.maxDepth) {
          continue;
        }

        if (entry.isDirectory() && !this.shouldSkipDirectory(entry.name, options)) {
          files.push(...await this.findFiles(fullPath, options));
        } else if (entry.isFile() && this.isValidFile(entry.name, options)) {
          files.push(fullPath);
        }
      }

      return files;
    } catch (error) {
      logger.error(`Failed to find files in ${dirPath}:`, error);
      throw error;
    }
  }

  private shouldSkipDirectory(dirname: string, options: ProcessOptions): boolean {
    const skipDirs = new Set([
      'node_modules', '.git', 'dist', 'build', 'coverage',
      ...(options.excludeDirs || [])
    ]);
    return skipDirs.has(dirname);
  }

  private isValidFile(filename: string, options: ProcessOptions): boolean {
    const validExtensions = new Set([
      '.ts', '.tsx', '.js', '.jsx',
      ...(options.includeExtensions || [])
    ]);
    return validExtensions.has(path.extname(filename));
  }

  public async processFile(filePath: string): Promise<void> {
    try {
      if (this.fileRegistry.has(filePath)) {
        logger.debug(`File ${filePath} already processed, skipping`);
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
    } catch (error) {
      logger.error(`Failed to process file ${filePath}:`, error);
      throw error;
    }
  }

  private async buildEdges(): Promise<void> {
    try {
      this.edges = [];
      for (const construct of this.constructs.values()) {
        const newEdges = this.detectEdges(construct);
        this.edges.push(...newEdges);
      }
    } catch (error) {
      logger.error('Failed to build edges:', error);
      throw error;
    }
  }

  private detectEdges(construct: CodeConstruct): Edge[] {
    const edges: Edge[] = [];

    // Handle dependencies
    construct.dependencies?.forEach((dep: string) => {
      edges.push({
        type: 'uses',
        from: construct.id!,
        to: dep,
        weight: 1
      });
    });

    // Add folder-based edges
    const folderChunk = this.getChunkByPath(path.dirname(construct.file));
    if (folderChunk) {
      folderChunk.constructs.forEach((other: CodeConstruct) => {
        if (other.id !== construct.id) {
          edges.push({
            type: 'same_folder',
            from: construct.id!,
            to: other.id!,
            weight: 0.5
          });
        }
      });
    }

    return edges;
  }

  public getChunkContext(constructId: string): ChunkContext | null {
    const construct = this.constructs.get(constructId);
    if (!construct) return null;

    const incomingEdges = this.edges.filter(edge => edge.to === constructId);
    const outgoingEdges = this.edges.filter(edge => edge.from === constructId);

    const relatedConstructs = new Set<CodeConstruct>();
    [...incomingEdges, ...outgoingEdges].forEach(edge => {
      const relatedId = edge.from === constructId ? edge.to : edge.from;
      const related = this.constructs.get(relatedId);
      if (related) relatedConstructs.add(related);
    });

    return {
      construct,
      incomingEdges,
      outgoingEdges,
      relatedConstructs: Array.from(relatedConstructs)
    };
  }

  public getParseErrors(): ParseError[] {
    return this.parser.getParseErrors();
  }

  public clearCache(): void {
    this.constructs.clear();
    this.edges = [];
    this.fileRegistry.clear();
    this.folderChunks = [];
    this.parser.clearParseErrors();
  }
}
