import { SyntaxNode } from 'tree-sitter';

export interface Position {
  row: number;
  column: number;
}

export type NodeType = 
  | 'function'
  | 'class'
  | 'method'
  | 'variable'
  | 'import'
  | 'export'
  | 'interface'
  | 'type'
  | 'enum'
  | string; // Allow other types for extensibility

export type EdgeType = 
  | 'contains'    // Class contains method
  | 'calls'       // Function calls another function
  | 'imports'     // File imports another file
  | 'extends'     // Class extends another
  | 'implements'  // Class implements interface
  | 'uses'        // Function uses variable
  | 'defines'     // File defines symbol
  | 'modifies'    // Function modifies variable
  | 'same_folder'; // In same folder

export interface CodeConstruct {
  type: NodeType;
  name: string;
  file: string;
  startPosition: Position;
  endPosition: Position;
  content: string;
  references?: string[];
  id?: string;
  dependencies?: string[];
  metadata?: {
    isExported?: boolean;
    visibility?: 'public' | 'private' | 'protected';
    isAsync?: boolean;
    isStatic?: boolean;
    parameters?: string[];
    returnType?: string;
  };
}

export interface Edge {
  type: EdgeType;
  from: string;
  to: string;
  weight: number;
  metadata?: {
    line: number;
    isAsync?: boolean;
    isDynamic?: boolean;
  };
}

export interface ChunkContext {
  construct: CodeConstruct;
  incomingEdges: Edge[];
  outgoingEdges: Edge[];
  relatedConstructs: CodeConstruct[];
}

export interface ParseError {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

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
