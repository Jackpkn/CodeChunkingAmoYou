import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import Parser from "tree-sitter";
import { CodeConstruct, extractConstructs } from "./chunker";
import { CodeGraph } from "./graph";

interface ChunkMetadata {
  fileHash: string;
  lastModified: number;
  chunks: CodeConstruct[];
  embeddings?: { [chunkId: string]: number[] };
}

interface ChunkStore {
  [filePath: string]: ChunkMetadata;
}

export class ChunkingSystem {
  private store: ChunkStore = {};
  private graph: CodeGraph;
  private cachePath: string;

  constructor(cachePath: string = "./chunk-cache.json") {
    this.cachePath = cachePath;
    this.graph = new CodeGraph();
    this.loadCache();
  }

  private loadCache() {
    if (fs.existsSync(this.cachePath)) {
      this.store = JSON.parse(fs.readFileSync(this.cachePath, "utf-8"));
    }
  }

  private saveCache() {
    fs.writeFileSync(this.cachePath, JSON.stringify(this.store, null, 2));
  }

  private getFileHash(filePath: string): string {
    const content = fs.readFileSync(filePath, "utf-8");
    return crypto.createHash("md5").update(content).digest("hex");
  }

  private shouldReprocessFile(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;

    const currentHash = this.getFileHash(filePath);
    const metadata = this.store[filePath];

    return !metadata || metadata.fileHash !== currentHash;
  }

  public async processFile(filePath: string) {
    if (!this.shouldReprocessFile(filePath)) {
      console.log(`Skipping ${filePath} - no changes detected`);
      return;
    }

    try {
      const fileHash = this.getFileHash(filePath);
      const lastModified = fs.statSync(filePath).mtimeMs;
      const fileContent = fs.readFileSync(filePath, "utf-8");

      // Initialize parser based on file extension
      const language = this.getLanguageFromExtension(filePath);
      const parser = this.initializeParser(language);

      // Parse the file and extract constructs
      const tree = parser.parse(fileContent);
      const chunks = this.extractConstructsFromTree(
        tree.rootNode,
        filePath,
        fileContent
      );

      // Build relationships between constructs
      this.buildConstructRelationships(chunks);

      // Update graph with new constructs
      chunks.forEach((chunk) => {
        if (chunk.id) {
          this.graph.addConstruct(chunk);
        }
      });

      // Save to cache
      this.store[filePath] = {
        fileHash,
        lastModified,
        chunks,
        embeddings: {}, // Initialize empty embeddings object
      };

      this.saveCache();

      console.log(
        `Processed ${filePath}: extracted ${chunks.length} constructs`
      );
    } catch (error) {
      console.error(`Error processing file ${filePath}:`, error);
      throw error;
    }
  }

  public async generateEmbeddings(
    chunks: CodeConstruct[]
  ): Promise<{ [chunkId: string]: number[] }> {
    const embeddings: { [chunkId: string]: number[] } = {};

    for (const chunk of chunks) {
      if (!chunk.id) continue;

      try {
        // Create a text representation for embedding
        const textForEmbedding = this.createEmbeddingText(chunk);

        // Generate embedding (using a simple hash-based approach for now)
        // In production, replace this with actual embedding service call
        const embedding = await this.generateSingleEmbedding(textForEmbedding);
        embeddings[chunk.id] = embedding;

        console.log(`Generated embedding for chunk: ${chunk.name || chunk.id}`);
      } catch (error) {
        console.error(
          `Failed to generate embedding for chunk ${chunk.id}:`,
          error
        );
      }
    }

    return embeddings;
  }

  public async findSimilarChunks(
    query: string,
    topK: number = 5
  ): Promise<Array<{ chunk: CodeConstruct; similarity: number }>> {
    try {
      // 1. Generate query embedding
      const queryEmbedding = await this.generateSingleEmbedding(query);

      // 2. Collect all chunks with embeddings
      const candidateChunks: Array<{
        chunk: CodeConstruct;
        embedding: number[];
      }> = [];

      for (const [filePath, metadata] of Object.entries(this.store)) {
        if (!metadata.embeddings) continue;

        for (const chunk of metadata.chunks) {
          if (chunk.id && metadata.embeddings[chunk.id]) {
            candidateChunks.push({
              chunk,
              embedding: metadata.embeddings[chunk.id],
            });
          }
        }
      }

      // 3. Calculate similarities and sort
      const similarities = candidateChunks.map(({ chunk, embedding }) => ({
        chunk,
        similarity: this.cosineSimilarity(queryEmbedding, embedding),
      }));

      // Sort by similarity (descending) and return top K
      return similarities
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, topK);
    } catch (error) {
      console.error("Error finding similar chunks:", error);
      return [];
    }
  }

  public getRelevantContext(chunk: CodeConstruct) {
    // Get related chunks based on dependencies
    const related = this.graph.getRelatedConstructs(chunk.id || "");
    return {
      chunk,
      related,
      dependencies: chunk.dependencies || [],
    };
  }

  private getLanguageFromExtension(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    switch (ext) {
      case ".ts":
      case ".tsx":
        return "typescript";
      case ".js":
      case ".jsx":
        return "javascript";
      case ".py":
        return "python";
      default:
        return "javascript"; // Default fallback
    }
  }

  private initializeParser(language: string): Parser {
    const parser = new Parser();

    try {
      let languageModule;
      switch (language) {
        case "typescript":
          languageModule = require("tree-sitter-typescript").typescript;
          break;
        case "javascript":
          languageModule = require("tree-sitter-javascript");
          break;
        case "python":
          languageModule = require("tree-sitter-python");
          break;
        default:
          throw new Error(`Unsupported language: ${language}`);
      }
      parser.setLanguage(languageModule);
    } catch (error) {
      console.warn(
        `Failed to load parser for ${language}, falling back to JavaScript`
      );
      // Fallback to JavaScript parser
      const jsModule = require("tree-sitter-javascript");
      parser.setLanguage(jsModule);
    }

    return parser;
  }

  private extractConstructsFromTree(
    rootNode: Parser.SyntaxNode,
    filePath: string,
    fileContent: string
  ): CodeConstruct[] {
    return extractConstructs(rootNode, filePath, fileContent);
  }

  private buildConstructRelationships(chunks: CodeConstruct[]): void {
    // Build dependencies between constructs in the same file
    const constructMap = new Map<string, CodeConstruct>();
    chunks.forEach((chunk) => {
      if (chunk.name) {
        constructMap.set(chunk.name, chunk);
      }
    });

    // Analyze content for references to other constructs
    chunks.forEach((chunk) => {
      const dependencies: string[] = [];

      // Simple heuristic: look for references to other construct names in the content
      constructMap.forEach((_, name) => {
        if (chunk.name !== name && chunk.content.includes(name)) {
          dependencies.push(name);
        }
      });

      chunk.dependencies = dependencies;
    });
  }

  private createEmbeddingText(chunk: CodeConstruct): string {
    // Create a comprehensive text representation for embedding
    const parts: string[] = [];

    // Add type and name
    if (chunk.type) parts.push(`Type: ${chunk.type}`);
    if (chunk.name) parts.push(`Name: ${chunk.name}`);

    // Add content (truncated if too long)
    const maxContentLength = 1000;
    const content =
      chunk.content.length > maxContentLength
        ? chunk.content.substring(0, maxContentLength) + "..."
        : chunk.content;
    parts.push(`Content: ${content}`);

    // Add dependencies if available
    if (chunk.dependencies && chunk.dependencies.length > 0) {
      parts.push(`Dependencies: ${chunk.dependencies.join(", ")}`);
    }

    return parts.join("\n");
  }

  private async generateSingleEmbedding(text: string): Promise<number[]> {
    // Simple hash-based embedding for demonstration
    // In production, replace with actual embedding service (OpenAI, Cohere, etc.)

    const hash = crypto.createHash("sha256").update(text).digest();
    const embedding: number[] = [];

    // Convert hash bytes to normalized float values (384 dimensions)
    const dimensions = 384;
    for (let i = 0; i < dimensions; i++) {
      const byteIndex = i % hash.length;
      const value = (hash[byteIndex] / 255) * 2 - 1; // Normalize to [-1, 1]
      embedding.push(value);
    }

    return embedding;
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error("Vectors must have the same length");
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    const magnitude = Math.sqrt(normA) * Math.sqrt(normB);
    return magnitude === 0 ? 0 : dotProduct / magnitude;
  }

  // Public methods for accessing cached data
  public getFileChunks(filePath: string): CodeConstruct[] {
    return this.store[filePath]?.chunks || [];
  }

  public getAllChunks(): CodeConstruct[] {
    const allChunks: CodeConstruct[] = [];
    Object.values(this.store).forEach((metadata) => {
      allChunks.push(...metadata.chunks);
    });
    return allChunks;
  }

  public getProcessedFiles(): string[] {
    return Object.keys(this.store);
  }

  public clearCache(): void {
    this.store = {};
    this.saveCache();
  }

  public getCacheStats() {
    const totalFiles = Object.keys(this.store).length;
    const totalChunks = this.getAllChunks().length;
    const cacheSize = fs.existsSync(this.cachePath)
      ? fs.statSync(this.cachePath).size
      : 0;

    return {
      totalFiles,
      totalChunks,
      cacheSize,
      cachePath: this.cachePath,
    };
  }
}
