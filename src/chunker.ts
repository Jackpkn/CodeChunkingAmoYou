import * as path from 'path';
import { SyntaxNode } from 'tree-sitter';
import { CodeGraph } from './graph';

/**
 * Represents a code construct, such as a class, function, or variable.
 */
export interface CodeConstruct {
  type: string;
  name: string;
  file: string;
  startPosition: { row: number; column: number };
  endPosition: { row: number; column: number };
  content: string;
  references?: string[];
  id?: string;
  dependencies?: string[];
}

/**
 * Represents a folder-level chunk of code constructs.
 */
export interface FolderChunk {
  path: string;
  name: string;
  constructs: CodeConstruct[];
  subfolders: FolderChunk[];
  metadata?: {
    totalFiles: number;
    totalConstructs: number;
    languages: Set<string>;
    lastModified: Date;
  };
}

/**
 * Recursively extracts code constructs from a syntax tree node.
 *
 * @param node The syntax tree node to extract constructs from.
 * @param file The file name of the code.
 * @param fileContent The content of the file.
 * @param constructs The list of extracted constructs.
 * @returns The updated list of extracted constructs.
 */
export function extractConstructs(node: SyntaxNode, file: string, fileContent: string, constructs: CodeConstruct[] = []): CodeConstruct[] {
  // Handle classes
  if (node.type === 'class_declaration') {
    const className = node.child(1)?.text || 'anonymous';
    constructs.push({
      type: 'class',
      name: className,
      file,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      id: `${file}:${className}`,
      content: fileContent.slice(node.startIndex, node.endIndex), // Get actual code
      dependencies: [],
    });

    // Extract methods inside the class
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child!.type === 'class_body') {
        for (let j = 0; j < child!.childCount; j++) {
          const method = child!.child(j);
          if (method!.type === 'method_definition') {
            constructs.push({
              type: 'method',
              name: method!.child(0)?.text || 'anonymous',
              file,
              startPosition: method!.startPosition,
              endPosition: method!.endPosition,
              content: fileContent.slice(method!.startIndex, method!.endIndex),
              dependencies: [className], // Link to containing class
            });
          }
        }
      }
    }
  }

  // Handle functions (including arrow functions and methods)
  if (
    node.type === 'function_declaration' ||
    node.type === 'arrow_function' ||
    node.type === 'function_expression'
  ) {
    constructs.push({
      type: 'function',
      name: node.child(1)?.text || 'anonymous',
      file,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      content: fileContent.slice(node.startIndex, node.endIndex),
    });
  }

  // Handle variables
  if (node.type === 'variable_declarator') {
    constructs.push({
      type: 'variable',
      name: node.child(0)?.text || 'anonymous',
      file,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      content: fileContent.slice(node.startIndex, node.endIndex),
    });
  }

  // Recursively process child nodes
  for (let i = 0; i < node.childCount; i++) {
    extractConstructs(node.child(i)!, file, fileContent, constructs);
  }

  return constructs;
}

/**
 * Creates folder-level chunks of code constructs.
 *
 * @param rootDir The root directory of the codebase.
 * @param constructs The list of extracted constructs.
 * @param maxFilesPerChunk The maximum number of files per chunk.
 * @returns The list of folder-level chunks.
 */
export function createFolderChunks(
  rootDir: string,
  constructs: CodeConstruct[],
  maxFilesPerChunk: number = 100
): FolderChunk[] {
  const folderMap = new Map<string, FolderChunk>();

  // Initialize folder structure
  constructs.forEach(construct => {
    const folderPath = path.dirname(construct.file);
    if (!folderMap.has(folderPath)) {
      folderMap.set(folderPath, {
        path: folderPath,
        name: path.basename(folderPath),
        constructs: [],
        subfolders: [],
        metadata: {
          totalFiles: 0,
          totalConstructs: 0,
          languages: new Set(),
          lastModified: new Date()
        }
      });
    }

    const folder = folderMap.get(folderPath)!;
    folder.constructs.push(construct);
    folder.metadata!.totalConstructs++;
    folder.metadata!.languages.add(path.extname(construct.file));
  });

  // Build folder hierarchy
  const rootChunks: FolderChunk[] = [];
  folderMap.forEach((chunk, folderPath) => {
    const parentPath = path.dirname(folderPath);
    if (parentPath !== folderPath && folderMap.has(parentPath)) {
      const parentChunk = folderMap.get(parentPath)!;
      parentChunk.subfolders.push(chunk);
    } else {
      rootChunks.push(chunk);
    }
  });

  // Balance chunks if they're too large
  return balanceChunks(rootChunks, maxFilesPerChunk);
}

/**
 * Balances folder-level chunks to ensure they don't exceed the maximum file limit.
 *
 * @param chunks The list of folder-level chunks.
 * @param maxFilesPerChunk The maximum number of files per chunk.
 * @returns The balanced list of folder-level chunks.
 */
function balanceChunks(chunks: FolderChunk[], maxFilesPerChunk: number): FolderChunk[] {
  return chunks.map(chunk => {
    if (chunk.constructs.length > maxFilesPerChunk) {
      // Split large chunks by type
      const typeGroups = new Map<string, CodeConstruct[]>();
      chunk.constructs.forEach(construct => {
        if (!typeGroups.has(construct.type)) {
          typeGroups.set(construct.type, []);
        }
        typeGroups.get(construct.type)!.push(construct);
      });

      // Create subfolders for each type if needed
      const newSubfolders: FolderChunk[] = [];
      typeGroups.forEach((constructs, type) => {
        if (constructs.length > maxFilesPerChunk) {
          // Further split by subdirectories or other criteria
          const subChunks = splitChunksBySize(constructs, maxFilesPerChunk);
          newSubfolders.push(...subChunks.map((subConstructs, i) => ({
            path: `${chunk.path}/${type}_${i}`,
            name: `${type}_${i}`,
            constructs: subConstructs,
            subfolders: [],
            metadata: {
              totalFiles: subConstructs.length,
              totalConstructs: subConstructs.length,
              languages: new Set(subConstructs.map(c => path.extname(c.file))),
              lastModified: new Date()
            }
          })));
        } else {
          newSubfolders.push({
            path: `${chunk.path}/${type}`,
            name: type,
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

      chunk.subfolders.push(...newSubfolders);
      chunk.constructs = []; // Move all constructs to subfolders
    }

    // Recursively balance subfolders
    chunk.subfolders = balanceChunks(chunk.subfolders, maxFilesPerChunk);
    return chunk;
  });
}

/**
 * Splits a list of constructs into chunks of a specified size.
 *
 * @param constructs The list of constructs to split.
 * @param size The size of each chunk.
 * @returns The list of chunks.
 */
function splitChunksBySize(constructs: CodeConstruct[], size: number): CodeConstruct[][] {
  const chunks: CodeConstruct[][] = [];
  for (let i = 0; i < constructs.length; i += size) {
    chunks.push(constructs.slice(i, i + size));
  }
  return chunks;
}

/**
 * Groups code constructs into chunks based on their dependencies.
 *
 * @param constructs The list of extracted constructs.
 * @param graph The code graph.
 * @returns The list of grouped constructs.
 */
export function groupConstructs(constructs: CodeConstruct[], graph: CodeGraph): CodeConstruct[][] {
  // First create folder-level chunks
  const folderChunks = createFolderChunks(process.cwd(), constructs);

  // Then extract high-level constructs (classes, major functions)
  const highLevelConstructs = constructs.filter(c =>
    c.type === 'class' ||
    (c.type === 'function' && !c.dependencies?.length) // Top-level functions
  );

  // Group related constructs
  const groups: CodeConstruct[][] = [];
  const processed = new Set<string>();

  highLevelConstructs.forEach(construct => {
    if (processed.has(construct.id!)) return;

    const group = [construct];
    processed.add(construct.id!);

    // Find related constructs from the same folder
    const folderChunk = findFolderChunk(folderChunks, construct.file);
    if (folderChunk) {
      folderChunk.constructs
        .filter(c => isRelated(c, construct))
        .forEach(related => {
          if (!processed.has(related.id!)) {
            group.push(related);
            processed.add(related.id!);
          }
        });
    }

    groups.push(group);
  });

  return groups;
}

/**
 * Finds a folder chunk that contains a specific file.
 *
 * @param chunks The list of folder chunks.
 * @param filePath The path of the file to find.
 * @returns The folder chunk that contains the file, or null if not found.
 */
function findFolderChunk(chunks: FolderChunk[], filePath: string): FolderChunk | null {
  for (const chunk of chunks) {
    if (filePath.startsWith(chunk.path)) {
      return chunk;
    }

    const found = findFolderChunk(chunk.subfolders, filePath);
    if (found) return found;
  }
  return null;
}

/**
 * Checks if two constructs are related.
 *
 * @param a The first construct.
 * @param b The second construct.
 * @returns True if the constructs are related, false otherwise.
 */
function isRelated(a: CodeConstruct, b: CodeConstruct): boolean {
  // Check if constructs are related based on:
  // 1. Dependencies
  if (a.dependencies?.includes(b.name) || b.dependencies?.includes(a.name)) {
    return true;
  }

  // 2. Same class/scope
  if (a.id && b.id) {
    const aScope = a.id.split(':')[1].split('.')[0];
    const bScope = b.id.split(':')[1].split('.')[0];
    if (aScope === bScope) return true;
  }

  // 3. File proximity (same directory)
  return path.dirname(a.file) === path.dirname(b.file);
}