import { CodeGraph, GraphNode, GraphRelationship } from '../graph/types';
import { loadParser, loadLanguage } from '../tree-sitter/parser-loader';
import { LANGUAGE_QUERIES } from './tree-sitter-queries';
import { generateId } from '../../lib/utils';
import { SymbolTable } from './symbol-table';
import { ASTCache } from './ast-cache';
import { getLanguageFromFilename } from './utils';

export type FileProgressCallback = (current: number, total: number, filePath: string) => void;

// Capture group suffix to graph node label mapping
const CAPTURE_LABEL_TABLE: Record<string, string> = {
  'definition.function': 'Function',
  'definition.class': 'Class',
  'definition.interface': 'Interface',
  'definition.method': 'Method',
  'definition.struct': 'Struct',
  'definition.enum': 'Enum',
  'definition.namespace': 'Namespace',
  'definition.module': 'Module',
  'definition.trait': 'Trait',
  'definition.impl': 'Impl',
  'definition.type': 'TypeAlias',
  'definition.const': 'Const',
  'definition.static': 'Static',
  'definition.typedef': 'Typedef',
  'definition.macro': 'Macro',
  'definition.union': 'Union',
  'definition.property': 'Property',
  'definition.record': 'Record',
  'definition.delegate': 'Delegate',
  'definition.annotation': 'Annotation',
  'definition.constructor': 'Constructor',
  'definition.template': 'Template',
};

// Capture keys checked in order per match
const LABEL_KEYS = Object.keys(CAPTURE_LABEL_TABLE);

/** Check public visibility using language-specific heuristics. */
const checkVisibility = (astNode: any, symbolName: string, lang: string): boolean => {
  // Python: leading underscore = private
  if (lang === 'python') {
    return !symbolName.startsWith('_');
  }

  // Go: uppercase first letter = exported
  if (lang === 'go') {
    if (symbolName.length < 1) return false;
    const ch = symbolName.charAt(0);
    return ch === ch.toUpperCase() && ch !== ch.toLowerCase();
  }

  // C/C++: no export keyword
  if (lang === 'c' || lang === 'cpp') {
    return false;
  }

  // Walk AST ancestors looking for visibility modifiers
  let cursor = astNode;
  while (cursor !== null) {
    const nodeType = cursor.type;

    if (lang === 'javascript' || lang === 'typescript') {
      if (
        nodeType === 'export_statement' ||
        nodeType === 'export_specifier' ||
        (nodeType === 'lexical_declaration' && cursor.parent?.type === 'export_statement')
      ) {
        return true;
      }
      if (cursor.text?.startsWith('export ')) {
        return true;
      }
    } else if (lang === 'java') {
      if (cursor.parent) {
        const parentNode = cursor.parent;
        let idx = 0;
        while (idx < parentNode.childCount) {
          const sibling = parentNode.child(idx);
          if (sibling?.type === 'modifiers' && sibling.text?.includes('public')) {
            return true;
          }
          idx++;
        }
        if (
          (parentNode.type === 'method_declaration' || parentNode.type === 'constructor_declaration') &&
          parentNode.text?.trimStart().startsWith('public')
        ) {
          return true;
        }
      }
    } else if (lang === 'csharp') {
      if (nodeType === 'modifier' || nodeType === 'modifiers') {
        if (cursor.text?.includes('public')) return true;
      }
    } else if (lang === 'rust') {
      if (nodeType === 'visibility_modifier' && cursor.text?.includes('pub')) {
        return true;
      }
    }

    cursor = cursor.parent;
  }

  return false;
};

/** Map capture groups to a graph node label. */
const deriveLabelFromCaptures = (captures: Record<string, any>): string => {
  for (const key of LABEL_KEYS) {
    if (captures[key] !== undefined) {
      return CAPTURE_LABEL_TABLE[key];
    }
  }
  return 'CodeElement';
};

export const processParsing = async (
  graph: CodeGraph,
  files: { path: string; content: string }[],
  symbolTable: SymbolTable,
  astCache: ASTCache,
  onFileProgress?: FileProgressCallback
) => {
  const parser = await loadParser();
  const fileCount = files.length;

  let idx = 0;
  while (idx < fileCount) {
    const entry = files[idx];
    onFileProgress?.(idx + 1, fileCount, entry.path);

    const lang = getLanguageFromFilename(entry.path);
    if (lang === null) {
      idx++;
      continue;
    }

    await loadLanguage(lang, entry.path);

    const syntaxTree = parser.parse(entry.content);
    astCache.set(entry.path, syntaxTree);

    const qs = LANGUAGE_QUERIES[lang];
    if (!qs) {
      idx++;
      continue;
    }

    let queryObj;
    let matchResults;
    try {
      queryObj = parser.getLanguage().query(qs);
      matchResults = queryObj.matches(syntaxTree.rootNode);
    } catch (err) {
      console.warn(`Query error for ${entry.path}:`, err);
      idx++;
      continue;
    }

    for (const m of matchResults) {
      const capturedNodes: Record<string, any> = {};
      m.captures.forEach(cap => {
        capturedNodes[cap.name] = cap.node;
      });

      // Imports and calls handled by separate processors
      if (capturedNodes['import'] || capturedNodes['call']) continue;

      const identNode = capturedNodes['name'];
      if (!identNode) continue;

      const symbolName = identNode.text;
      const label = deriveLabelFromCaptures(capturedNodes);
      const symbolId = generateId(label, `${entry.path}:${symbolName}`);

      const graphNode: GraphNode = {
        id: symbolId,
        label: label as any,
        properties: {
          name: symbolName,
          filePath: entry.path,
          startLine: identNode.startPosition.row,
          endLine: identNode.endPosition.row,
          language: lang,
          isExported: checkVisibility(identNode, symbolName, lang),
        },
      };
      graph.addNode(graphNode);

      symbolTable.add(entry.path, symbolName, symbolId, label);

      const parentFileId = generateId('File', entry.path);
      const edgeId = generateId('DEFINES', `${parentFileId}->${symbolId}`);
      const edge: GraphRelationship = {
        id: edgeId,
        sourceId: parentFileId,
        targetId: symbolId,
        type: 'DEFINES',
        confidence: 1.0,
        reason: '',
      };
      graph.addRelationship(edge);
    }

    idx++;
  }
};
