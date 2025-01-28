import * as fs from 'fs';
import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';

export function initializeParser(language: string) {
  const parser = new Parser();
  switch (language) {
    case 'javascript':
      parser.setLanguage(JavaScript);
      break;
    case 'typescript':
      parser.setLanguage(TypeScript);
      break;
    default:
      throw new Error(`Unsupported language: ${language}`);
  }
  return parser;
}

export function parseFile(parser: Parser, filePath: string): Parser.Tree {
  const sourceCode = fs.readFileSync(filePath, 'utf8');
  return parser.parse(sourceCode);
}