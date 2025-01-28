import Parser from 'tree-sitter';
import { CodeConstruct, NodeType, ParseError } from '../types/index';
import { logger } from '../utils/logger';

export class ParserService {
  private parser: Parser;
  private parsedTrees: Map<string, Parser.Tree> = new Map();
  private parseErrors: ParseError[] = [];

  constructor() {
    this.parser = new Parser();
  }

  public async initialize(language: string): Promise<void> {
    try {
      let languageModule;
      switch (language.toLowerCase()) {
        case 'javascript':
          languageModule = require('tree-sitter-javascript');
          break;
        case 'typescript':
          languageModule = require('tree-sitter-typescript').typescript;
          break;
        case 'python':
          languageModule = require('tree-sitter-python');
          break;
        default:
          throw new Error(`Unsupported language: ${language}`);
      }
      this.parser.setLanguage(languageModule);
    } catch (error) {
      logger.error(`Failed to initialize parser for ${language}:`, error);
      throw error;
    }
  }

  public parseFile(filePath: string, content: string): Parser.Tree {
    try {
      // Try to reuse existing tree for incremental parsing
      const oldTree = this.parsedTrees.get(filePath);
      const tree = this.parser.parse(content, oldTree);
      this.parsedTrees.set(filePath, tree);
      return tree;
    } catch (error) {
      logger.error(`Failed to parse file ${filePath}:`, error);
      throw error;
    }
  }

  public extractConstructs(node: Parser.SyntaxNode, filePath: string, content: string): CodeConstruct[] {
    const constructs: CodeConstruct[] = [];
    try {
      this.traverseNode(node, filePath, content, constructs);
    } catch (error) {
      logger.error(`Failed to extract constructs from ${filePath}:`, error);
      this.addParseError(filePath, node, error);
    }
    return constructs;
  }

  private traverseNode(
    node: Parser.SyntaxNode,
    filePath: string,
    content: string,
    constructs: CodeConstruct[],
    parentConstruct?: CodeConstruct
  ): void {
    try {
      const construct = this.processNode(node, filePath, content, parentConstruct);
      if (construct) {
        constructs.push(construct);
        // If this is a container (like class), process its children
        if (this.isContainerNode(node)) {
          for (let i = 0; i < node.childCount; i++) {
            const child = node.child(i);
            if (child) {
              this.traverseNode(child, filePath, content, constructs, construct);
            }
          }
        }
      } else {
        // Continue traversing if no construct was created
        for (let i = 0; i < node.childCount; i++) {
          const child = node.child(i);
          if (child) {
            this.traverseNode(child, filePath, content, constructs, parentConstruct);
          }
        }
      }
    } catch (error) {
      logger.error(`Failed to traverse node in ${filePath}:`, error);
      this.addParseError(filePath, node, error);
    }
  }

  private processNode(
    node: Parser.SyntaxNode,
    filePath: string,
    content: string,
    parentConstruct?: CodeConstruct
  ): CodeConstruct | null {
    const nodeContent = content.slice(node.startIndex, node.endIndex).trim();
    if (!nodeContent) return null;

    switch (node.type) {
      case 'class_declaration':
      case 'class':
        return this.createClassConstruct(node, filePath, nodeContent);

      case 'function_declaration':
      case 'function':
        return this.createFunctionConstruct(node, filePath, nodeContent, parentConstruct);

      case 'method_definition':
        return this.createMethodConstruct(node, filePath, nodeContent, parentConstruct);

      case 'variable_declaration':
        return this.createVariableConstruct(node, filePath, nodeContent);

      // Add more node types as needed

      default:
        return null;
    }
  }

  private isContainerNode(node: Parser.SyntaxNode): boolean {
    return ['class_declaration', 'class', 'function_declaration', 'function'].includes(node.type);
  }

  private createClassConstruct(node: Parser.SyntaxNode, filePath: string, content: string): CodeConstruct {
    const nameNode = node.childForFieldName('name');
    return {
      type: 'class',
      name: nameNode?.text || 'anonymous',
      file: filePath,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      content: content,
      id: `${filePath}:${nameNode?.text || 'anonymous'}`,
      dependencies: [],
      metadata: {
        isExported: this.hasExportKeyword(node),
        visibility: this.getVisibility(node),
      }
    };
  }

  private createFunctionConstruct(
    node: Parser.SyntaxNode, 
    filePath: string, 
    content: string,
    parentConstruct?: CodeConstruct
  ): CodeConstruct {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || 'anonymous';
    return {
      type: 'function',
      name,
      file: filePath,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      content,
      id: `${filePath}:${name}`,
      dependencies: parentConstruct ? [parentConstruct.name] : [],
      metadata: {
        isExported: this.hasExportKeyword(node),
        isAsync: node.previousSibling?.type === 'async',
      }
    };
  }

  private createMethodConstruct(
    node: Parser.SyntaxNode, 
    filePath: string, 
    content: string,
    parentConstruct?: CodeConstruct
  ): CodeConstruct {
    const nameNode = node.childForFieldName('name');
    const name = nameNode?.text || 'anonymous';
    return {
      type: 'method',
      name,
      file: filePath,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      content,
      id: `${filePath}:${parentConstruct?.name}.${name}`,
      dependencies: parentConstruct ? [parentConstruct.name] : [],
      metadata: {
        isAsync: node.previousSibling?.type === 'async',
        isStatic: this.hasStaticKeyword(node),
        visibility: this.getMethodVisibility(node)
      }
    };
  }

  private createVariableConstruct(
    node: Parser.SyntaxNode, 
    filePath: string, 
    content: string
  ): CodeConstruct {
    const declarator = node.descendantsOfType('variable_declarator')[0];
    const name = declarator?.childForFieldName('name')?.text || 'anonymous';
    return {
      type: 'variable',
      name,
      file: filePath,
      startPosition: node.startPosition,
      endPosition: node.endPosition,
      content,
      id: `${filePath}:${name}`,
      metadata: {
        isExported: this.hasExportKeyword(node)
      }
    };
  }

  private hasStaticKeyword(node: Parser.SyntaxNode): boolean {
    return node.previousSibling?.type === 'static';
  }

  private getMethodVisibility(node: Parser.SyntaxNode): 'public' | 'private' | 'protected' {
    const modifier = node.previousSibling;
    if (!modifier) return 'public';
    
    switch (modifier.type) {
      case 'private':
        return 'private';
      case 'protected':
        return 'protected';
      default:
        return 'public';
    }
  }

  private addParseError(filePath: string, node: Parser.SyntaxNode, error: any): void {
    this.parseErrors.push({
      file: filePath,
      line: node.startPosition.row,
      column: node.startPosition.column,
      message: error.message || 'Unknown error',
      severity: 'error'
    });
  }

  private hasExportKeyword(node: Parser.SyntaxNode): boolean {
    const parent = node.parent;
    return parent?.type === 'export_statement';
  }

  private getVisibility(node: Parser.SyntaxNode): 'public' | 'private' | 'protected' {
    // Implement visibility detection logic
    return 'public';
  }

  public getParseErrors(): ParseError[] {
    return this.parseErrors;
  }

  public clearParseErrors(): void {
    this.parseErrors = [];
  }
}
