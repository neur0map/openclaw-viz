/**
 * Context Builder
 *
 * Gathers project-level context (stats, hotspots, folder tree) and
 * appends it to the system prompt so the LLM has structural awareness
 * before it starts answering.
 */

export interface CodebaseStats {
  projectName: string;
  fileCount: number;
  functionCount: number;
  classCount: number;
  interfaceCount: number;
  methodCount: number;
}

export interface Hotspot {
  name: string;
  type: string;
  filePath: string;
  connections: number;
}

interface DirectoryEntry {
  path: string;
  name: string;
  depth: number;
  fileCount: number;
  children: DirectoryEntry[];
}

/**
 * Aggregated project context injected into the system prompt.
 */
export interface ProjectContext {
  stats: CodebaseStats;
  hotspots: Hotspot[];
  folderTree: string;
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Extract a numeric count from either a named-property or positional row. */
const extractCount = (row: any): number => {
  if (Array.isArray(row)) return row[0] ?? 0;
  return row?.count ?? 0;
};

const NODE_COUNT_QUERIES: ReadonlyArray<{ key: string; cypher: string }> = [
  { key: 'files',      cypher: 'MATCH (n:File) RETURN COUNT(n) AS count' },
  { key: 'functions',  cypher: 'MATCH (n:Function) RETURN COUNT(n) AS count' },
  { key: 'classes',    cypher: 'MATCH (n:Class) RETURN COUNT(n) AS count' },
  { key: 'interfaces', cypher: 'MATCH (n:Interface) RETURN COUNT(n) AS count' },
  { key: 'methods',    cypher: 'MATCH (n:Method) RETURN COUNT(n) AS count' },
];

/* ------------------------------------------------------------------ */
/*  Folder-tree rendering                                              */
/* ------------------------------------------------------------------ */

interface FolderNode {
  isLeaf: boolean;
  subtree: Map<string, FolderNode>;
  descendantFiles: number;
}

const newFolderNode = (leaf: boolean): FolderNode => ({
  isLeaf: leaf,
  subtree: new Map(),
  descendantFiles: 0,
});

/** Insert a path into the tree, bumping ancestor file counts along the way. */
const insertPath = (root: FolderNode, filePath: string): void => {
  const segments = filePath.replace(/\\/g, '/').split('/').filter(Boolean);
  let cursor = root;

  segments.forEach((seg, idx) => {
    const leaf = idx === segments.length - 1;

    if (!cursor.subtree.has(seg)) {
      cursor.subtree.set(seg, newFolderNode(leaf));
    }

    const next = cursor.subtree.get(seg)!;
    if (leaf) {
      let ancestor = root;
      for (let j = 0; j < idx; j++) {
        ancestor = ancestor.subtree.get(segments[j])!;
        ancestor.descendantFiles++;
      }
    }
    cursor = next;
  });
};

/** Render tree nodes into indented text. Directories past maxDepth are collapsed. */
const renderTree = (
  node: FolderNode,
  prefix: string,
  depthLevel: number,
  depthCap: number,
  out: string[]
): void => {
  const items = [...node.subtree.entries()];

  // Directories first (by descendant count desc), then files alphabetically
  items.sort(([nameA, a], [nameB, b]) => {
    if (a.isLeaf !== b.isLeaf) return a.isLeaf ? 1 : -1;
    if (!a.isLeaf && !b.isLeaf) return b.descendantFiles - a.descendantFiles;
    return nameA.localeCompare(nameB);
  });

  items.forEach(([name, child]) => {
    if (child.isLeaf) {
      out.push(`${prefix}${name}`);
    } else if (depthLevel >= depthCap) {
      out.push(`${prefix}${name}/ (${child.descendantFiles} files)`);
    } else {
      out.push(`${prefix}${name}/`);
      renderTree(child, prefix + '  ', depthLevel + 1, depthCap, out);
    }
  });
};

/** Turn a flat list of file paths into an indented directory tree string. */
const composeDirectoryTree = (paths: string[], depthCap: number): string => {
  const root = newFolderNode(false);
  paths.forEach((p) => insertPath(root, p));

  const lines: string[] = [];
  renderTree(root, '', 0, depthCap, lines);
  return lines.join('\n');
};

/* ------------------------------------------------------------------ */
/*  Legacy tree helpers (kept for internal compat)                     */
/* ------------------------------------------------------------------ */

function buildTreeFromPaths(paths: string[], maxDepth: number): Map<string, any> {
  const root = new Map<string, any>();

  paths.forEach((fullPath) => {
    const normalized = fullPath.replace(/\\/g, '/');
    const parts = normalized.split('/').filter(Boolean);
    let cursor = root;
    const limit = Math.min(parts.length, maxDepth + 1);

    for (let i = 0; i < limit; i++) {
      const segment = parts[i];
      const leaf = i === parts.length - 1;

      if (!cursor.has(segment)) {
        cursor.set(segment, leaf ? null : new Map<string, any>());
      }

      const child = cursor.get(segment);
      if (child instanceof Map) {
        cursor = child;
      } else {
        break;
      }
    }
  });

  return root;
}

function tallyDescendants(node: Map<string, any>): number {
  let total = 0;
  node.forEach((val) => {
    total += val instanceof Map ? 1 + tallyDescendants(val) : 1;
  });
  return total;
}

function formatTreeAsAscii(
  tree: Map<string, any>,
  prefix: string,
  isLast: boolean = true
): string {
  const entries = [...tree.entries()];

  entries.sort(([aKey, aVal], [bKey, bVal]) => {
    const aDir = aVal instanceof Map;
    const bDir = bVal instanceof Map;
    if (aDir !== bDir) return bDir ? 1 : -1;
    return aKey.localeCompare(bKey);
  });

  const fragments: string[] = [];

  entries.forEach(([label, subtree], pos) => {
    const last = pos === entries.length - 1;
    const branch = last ? '\u2514\u2500\u2500 ' : '\u251C\u2500\u2500 ';
    const nextPrefix = prefix + (last ? '    ' : '\u2502   ');

    if (subtree instanceof Map && subtree.size > 0) {
      const descendantCount = tallyDescendants(subtree);
      const suffix = descendantCount > 3 ? ` (${descendantCount} items)` : '';
      fragments.push(`${prefix}${branch}${label}/${suffix}`);
      fragments.push(formatTreeAsAscii(subtree, nextPrefix, last));
    } else if (subtree instanceof Map) {
      fragments.push(`${prefix}${branch}${label}/`);
    } else {
      fragments.push(`${prefix}${branch}${label}`);
    }
  });

  return fragments.filter(Boolean).join('\n');
}

/* ------------------------------------------------------------------ */
/*  Exported query functions                                           */
/* ------------------------------------------------------------------ */

export async function getCodebaseStats(
  executeQuery: (cypher: string) => Promise<any[]>,
  projectName: string
): Promise<CodebaseStats> {
  try {
    const tally: Record<string, number> = {};

    await Promise.all(
      NODE_COUNT_QUERIES.map(async ({ key, cypher }) => {
        try {
          const rows = await executeQuery(cypher);
          tally[key] = extractCount(rows[0]);
        } catch {
          tally[key] = 0;
        }
      })
    );

    return {
      projectName,
      fileCount: tally.files,
      functionCount: tally.functions,
      classCount: tally.classes,
      interfaceCount: tally.interfaces,
      methodCount: tally.methods,
    };
  } catch (err) {
    console.error('Failed to get codebase stats:', err);
    return {
      projectName,
      fileCount: 0,
      functionCount: 0,
      classCount: 0,
      interfaceCount: 0,
      methodCount: 0,
    };
  }
}

export async function getHotspots(
  executeQuery: (cypher: string) => Promise<any[]>,
  limit: number = 8
): Promise<Hotspot[]> {
  try {
    const cypher = `
      MATCH (n)-[r:CodeEdge]-(m)
      WHERE n.name IS NOT NULL
      WITH n, COUNT(r) AS connections
      ORDER BY connections DESC
      LIMIT ${limit}
      RETURN n.name AS name, LABEL(n) AS type, n.filePath AS filePath, connections
    `;

    const rows = await executeQuery(cypher);

    return rows.reduce<Hotspot[]>((acc, row) => {
      const h: Hotspot = Array.isArray(row)
        ? { name: row[0], type: row[1], filePath: row[2], connections: row[3] }
        : { name: row.name, type: row.type, filePath: row.filePath, connections: row.connections };

      if (h.name && h.type) acc.push(h);
      return acc;
    }, []);
  } catch (err) {
    console.error('Failed to get hotspots:', err);
    return [];
  }
}

/**
 * Build an ASCII folder tree from file paths in the graph.
 */
export async function getFolderTree(
  executeQuery: (cypher: string) => Promise<any[]>,
  maxDepth: number = 10
): Promise<string> {
  try {
    const cypher = 'MATCH (f:File) RETURN f.filePath AS path ORDER BY path';
    const rows = await executeQuery(cypher);

    const paths: string[] = rows.reduce<string[]>((acc, row) => {
      const p = Array.isArray(row) ? row[0] : row.path;
      if (p) acc.push(p);
      return acc;
    }, []);

    if (paths.length === 0) return '';

    return composeDirectoryTree(paths, maxDepth);
  } catch (err) {
    console.error('Failed to get folder tree:', err);
    return '';
  }
}

/**
 * Gather full project context (stats + hotspots + tree).
 */
export async function buildProjectContext(
  executeQuery: (cypher: string) => Promise<any[]>,
  projectName: string
): Promise<ProjectContext> {
  const [stats, hotspots, folderTree] = await Promise.all([
    getCodebaseStats(executeQuery, projectName),
    getHotspots(executeQuery),
    getFolderTree(executeQuery),
  ]);

  return { stats, hotspots, folderTree };
}

/**
 * Render context as markdown suitable for prompt injection.
 */
export function formatContextForPrompt(context: ProjectContext): string {
  const { stats, hotspots, folderTree } = context;

  const sections: string[] = [];

  sections.push(`### CODEBASE: ${stats.projectName}`);

  const counters = [
    `Files: ${stats.fileCount}`,
    `Functions: ${stats.functionCount}`,
    stats.classCount > 0 ? `Classes: ${stats.classCount}` : null,
    stats.interfaceCount > 0 ? `Interfaces: ${stats.interfaceCount}` : null,
  ].filter(Boolean);

  sections.push(counters.join(' | '));
  sections.push('');

  if (hotspots.length > 0) {
    sections.push('**Hotspots** (most connected):');
    hotspots.slice(0, 5).forEach((h) => {
      sections.push(`- \`${h.name}\` (${h.type}) — ${h.connections} edges`);
    });
    sections.push('');
  }

  if (folderTree) {
    sections.push('### STRUCTURE');
    sections.push('```');
    sections.push(stats.projectName + '/');
    sections.push(folderTree);
    sections.push('```');
  }

  return sections.join('\n');
}

/**
 * Append dynamic project context to the base system prompt.
 * Context goes at the end so core instructions stay at the top.
 */
export function composeSystemPrompt(
  basePrompt: string,
  context: ProjectContext
): string {
  const rendered = formatContextForPrompt(context);

  return `${basePrompt}\n\n---\n\n## CURRENT PROJECT\n${rendered}`;
}
