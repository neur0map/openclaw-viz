/**
 * In-browser KuzuDB WASM adapter.
 *
 * Runs an in-memory database, ingesting data via CSV bulk-load:
 * files are written to the WASM VFS and loaded with COPY FROM.
 */

import { CodeGraph } from '../graph/types';
import {
  NODE_TABLES,
  EDGE_TABLE_NAME,
  SCHEMA_QUERIES,
  VECTOR_TABLE,
  NodeTableName,
} from './schema';
import { generateAllCSVs } from './csv-generator';

// -- Singletons --------------------------------------------------------------

let wasmLib: any = null;
let database: any = null;
let connection: any = null;

// Tables requiring backtick-quoting in DDL
const QUOTED_TABLE_NAMES = new Set<string>([
  'Struct', 'Enum', 'Macro', 'Typedef', 'Union', 'Namespace', 'Trait', 'Impl',
  'TypeAlias', 'Const', 'Static', 'Property', 'Record', 'Delegate', 'Annotation',
  'Constructor', 'Template', 'Module',
]);

// CSV options: auto-detect off to prevent backslash misinterpretation, RFC 4180 quoting
const CSV_IMPORT_OPTS = `(HEADER=true, ESCAPE='"', DELIM=',', QUOTE='"', PARALLEL=false, auto_detect=false)`;

// -- Internal helpers --------------------------------------------------------

/** Backtick-quote table names when needed. */
const quoteName = (name: string): string =>
  QUOTED_TABLE_NAMES.has(name) ? `\`${name}\`` : name;

/** COPY FROM statement for a node table. */
const makeCopyStatement = (table: NodeTableName, csvPath: string): string => {
  const escaped = quoteName(table);
  switch (table) {
    case 'File':
      return `COPY ${escaped}(id, name, filePath, content) FROM "${csvPath}" ${CSV_IMPORT_OPTS}`;
    case 'Folder':
      return `COPY ${escaped}(id, name, filePath) FROM "${csvPath}" ${CSV_IMPORT_OPTS}`;
    case 'Community':
      return `COPY ${escaped}(id, label, heuristicLabel, keywords, description, enrichedBy, cohesion, symbolCount) FROM "${csvPath}" ${CSV_IMPORT_OPTS}`;
    case 'Process':
      return `COPY ${escaped}(id, label, heuristicLabel, processType, stepCount, communities, entryPointId, terminalId) FROM "${csvPath}" ${CSV_IMPORT_OPTS}`;
    default:
      // Shared column layout for code-element tables
      return `COPY ${escaped}(id, name, filePath, startLine, endLine, isExported, content) FROM "${csvPath}" ${CSV_IMPORT_OPTS}`;
  }
};

/** Infer table name from a node ID prefix. */
const inferTableFromId = (nodeId: string): string => {
  if (nodeId.startsWith('comm_')) return 'Community';
  if (nodeId.startsWith('proc_')) return 'Process';
  return nodeId.split(':')[0];
};

/** Extract column names from a Cypher RETURN clause. */
const extractColumnNames = (cypher: string): string[] => {
  const seg = cypher.match(/RETURN\s+(.+?)(?:\s+ORDER|\s+LIMIT|\s+SKIP|\s*$)/is);
  if (!seg) return [];
  return seg[1].split(',').map((token) => {
    const trimmed = token.trim();
    const aliasHit = trimmed.match(/\s+AS\s+(\w+)\s*$/i);
    if (aliasHit) return aliasHit[1];
    const propHit = trimmed.match(/\.(\w+)\s*$/);
    if (propHit) return propHit[1];
    const fnHit = trimmed.match(/^(\w+)\s*\(/);
    if (fnHit) return fnHit[1];
    return trimmed.replace(/[^a-zA-Z0-9_]/g, '_');
  });
};

// -- Public API --------------------------------------------------------------

/** Bootstrap KuzuDB WASM and create the in-memory database. */
export const initKuzu = async () => {
  if (connection) return { db: database, conn: connection, kuzu: wasmLib };

  try {
    if (import.meta.env.DEV) console.log('[prowl:kuzu] initializing...');

    const imported = await import('kuzu-wasm');
    wasmLib = imported.default || imported;
    await wasmLib.init();

    const POOL_BYTES = 512 * 1024 * 1024;
    database = new wasmLib.Database(':memory:', POOL_BYTES);
    connection = new wasmLib.Connection(database);

    if (import.meta.env.DEV) console.log('[prowl:kuzu] wasm initialized');

    // Run DDL, tolerating "already exists"
    let idx = 0;
    while (idx < SCHEMA_QUERIES.length) {
      try {
        await connection.query(SCHEMA_QUERIES[idx]);
      } catch (_schemaErr) {
        if (import.meta.env.DEV) {
          console.warn('DDL statement skipped (table likely exists):', _schemaErr);
        }
      }
      idx++;
    }

    if (import.meta.env.DEV) console.log('[prowl:kuzu] schema created');
    return { db: database, conn: connection, kuzu: wasmLib };
  } catch (err) {
    if (import.meta.env.DEV) console.error('[prowl:kuzu] initialization failed:', err);
    throw err;
  }
};

/** Bulk-load a CodeGraph into KuzuDB via CSV COPY FROM. */
export const loadGraphToKuzu = async (
  graph: CodeGraph,
  fileContents: Map<string, string>,
) => {
  const { conn, kuzu } = await initKuzu();

  try {
    if (import.meta.env.DEV) console.log(`[prowl:kuzu] generating CSVs for ${graph.nodeCount} nodes`);

    const csvPayload = generateAllCSVs(graph, fileContents);
    const vfs = kuzu.FS;

    // Write node CSVs to the VFS
    const pendingFiles: Array<{ table: NodeTableName; filePath: string }> = [];
    const tableEntries = Array.from(csvPayload.nodes.entries());
    let tIdx = 0;
    while (tIdx < tableEntries.length) {
      const [tblName, csvText] = tableEntries[tIdx];
      tIdx++;
      // Skip header-only tables
      const lineCount = csvText.split('\n').length;
      if (lineCount <= 1) continue;
      const dest = '/' + tblName.toLowerCase() + '.csv';
      try { await vfs.unlink(dest); } catch { /* noop */ }
      await vfs.writeFile(dest, csvText);
      pendingFiles.push({ table: tblName, filePath: dest });
    }

    // Parse edge rows from CSV (skip header)
    const relRows = csvPayload.relCSV.split('\n').slice(1).filter((ln: string) => ln.trim());
    const totalRels = relRows.length;

    if (import.meta.env.DEV) {
      console.log(`[prowl:kuzu] wrote ${pendingFiles.length} node CSVs, ${totalRels} relations to insert`);
    }

    // Load node tables first (edges reference nodes)
    let fIdx = 0;
    while (fIdx < pendingFiles.length) {
      const { table, filePath } = pendingFiles[fIdx];
      await conn.query(makeCopyStatement(table, filePath));
      fIdx++;
    }

    // Insert edges individually (COPY FROM unsupported for multi-pair REL tables)
    const knownTables = new Set<string>(NODE_TABLES as readonly string[]);
    let successCount = 0;
    let failCount = 0;
    const failBuckets = new Map<string, number>();

    const REL_PATTERN = /"([^"]*)","([^"]*)","([^"]*)",([0-9.]+),"([^"]*)",([0-9-]+)/;

    for (let rIdx = 0; rIdx < relRows.length; rIdx++) {
      const row = relRows[rIdx];
      try {
        const parsed = row.match(REL_PATTERN);
        if (!parsed) continue;

        const srcId = parsed[1];
        const dstId = parsed[2];
        const edgeKind = parsed[3];
        const conf = parseFloat(parsed[4]) || 1.0;
        const rsn = parsed[5];
        const stepVal = parseInt(parsed[6]) || 0;

        const srcTable = inferTableFromId(srcId);
        const dstTable = inferTableFromId(dstId);

        // Both endpoints must be known tables
        if (!knownTables.has(srcTable) || !knownTables.has(dstTable)) {
          failCount++;
          continue;
        }

        const cypher = [
          `MATCH (a:${quoteName(srcTable)} {id: '${srcId.replace(/'/g, "''")}'}),`,
          `      (b:${quoteName(dstTable)} {id: '${dstId.replace(/'/g, "''")}'})`,
          `CREATE (a)-[:${EDGE_TABLE_NAME} {type: '${edgeKind}', confidence: ${conf}, reason: '${rsn.replace(/'/g, "''")}', step: ${stepVal}}]->(b)`,
        ].join('\n');

        await conn.query(cypher);
        successCount++;
      } catch (insertErr) {
        failCount++;
        const m2 = row.match(/"([^"]*)","([^"]*)","([^"]*)",([0-9.]+),"([^"]*)"/);
        if (m2) {
          const bucket = `${m2[3]}:${inferTableFromId(m2[1])}->${inferTableFromId(m2[2])}`;
          failBuckets.set(bucket, (failBuckets.get(bucket) || 0) + 1);
          if (import.meta.env.DEV) {
            console.warn(`[prowl:kuzu] skipped: ${bucket} | "${m2[1]}" -> "${m2[2]}" | ${insertErr instanceof Error ? insertErr.message : String(insertErr)}`);
          }
        }
      }
    }

    if (import.meta.env.DEV) {
      console.log(`[prowl:kuzu] inserted ${successCount}/${totalRels} relations`);
      if (failCount > 0) {
        const ranked = Array.from(failBuckets.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10);
        console.warn(`[prowl:kuzu] skipped ${failCount}/${totalRels} relations (top by kind/pair):`, ranked);
      }
    }

    // Verify node counts
    let nodeTotal = 0;
    for (const tName of NODE_TABLES) {
      try {
        const qr = await conn.query(`MATCH (n:${tName}) RETURN count(n) AS cnt`);
        const r = await qr.getNext();
        nodeTotal += Number(r ? (r.cnt ?? r[0] ?? 0) : 0);
      } catch {
        // empty or absent table
      }
    }

    if (import.meta.env.DEV) console.log(`[prowl:kuzu] bulk load complete — ${nodeTotal} nodes, ${successCount} edges`);

    // Clean up temp CSV files
    pendingFiles.forEach(async ({ filePath }) => {
      try { await vfs.unlink(filePath); } catch { /* noop */ }
    });

    return { success: true, count: nodeTotal };
  } catch (topErr) {
    if (import.meta.env.DEV) console.error('[prowl:kuzu] bulk load failed:', topErr);
    return { success: false, count: 0 };
  }
};

/** Execute a Cypher query, returning named objects. */
export const executeQuery = async (cypher: string): Promise<any[]> => {
  if (!connection) await initKuzu();

  try {
    const result = await connection.query(cypher);
    const colNames = extractColumnNames(cypher);

    const collected: any[] = [];
    while (await result.hasNext()) {
      const row = await result.getNext();
      if (Array.isArray(row) && colNames.length === row.length) {
        const obj: Record<string, any> = {};
        colNames.forEach((col, i) => { obj[col] = row[i]; });
        collected.push(obj);
      } else {
        collected.push(row);
      }
    }
    return collected;
  } catch (qErr) {
    if (import.meta.env.DEV) console.error('Query execution failed:', qErr);
    throw qErr;
  }
};

/** Database node/edge counts. */
export const getKuzuStats = async (): Promise<{ nodes: number; edges: number }> => {
  if (!connection) return { nodes: 0, edges: 0 };

  try {
    let nodeTally = 0;
    for (const tbl of NODE_TABLES) {
      try {
        const res = await connection.query(`MATCH (n:${tbl}) RETURN count(n) AS cnt`);
        const row = await res.getNext();
        nodeTally += Number(row?.cnt ?? row?.[0] ?? 0);
      } catch {
        // empty or missing
      }
    }

    let edgeTally = 0;
    try {
      const eRes = await connection.query(`MATCH ()-[r:${EDGE_TABLE_NAME}]->() RETURN count(r) AS cnt`);
      const eRow = await eRes.getNext();
      edgeTally = Number(eRow?.cnt ?? eRow?.[0] ?? 0);
    } catch {
      // no edges
    }

    return { nodes: nodeTally, edges: edgeTally };
  } catch (statsErr) {
    if (import.meta.env.DEV) console.warn('Failed to get Kuzu stats:', statsErr);
    return { nodes: 0, edges: 0 };
  }
};

/** True when KuzuDB is initialised. */
export const isKuzuReady = (): boolean => {
  return connection !== null && database !== null;
};

/** Close the database connection. */
export const closeKuzu = async (): Promise<void> => {
  if (connection) {
    try { await connection.close(); } catch { /* noop */ }
    connection = null;
  }
  if (database) {
    try { await database.close(); } catch { /* noop */ }
    database = null;
  }
  wasmLib = null;
};

/** Execute a prepared Cypher statement with parameters. */
export const executePrepared = async (
  cypher: string,
  params: Record<string, any>,
): Promise<any[]> => {
  if (!connection) await initKuzu();

  try {
    const prepared = await connection.prepare(cypher);
    if (!prepared.isSuccess()) {
      const msg = await prepared.getErrorMessage();
      throw new Error(`Prepare failed: ${msg}`);
    }

    const qResult = await connection.execute(prepared, params);
    const rows: any[] = [];
    while (await qResult.hasNext()) {
      rows.push(await qResult.getNext());
    }

    await prepared.close();
    return rows;
  } catch (prepErr) {
    if (import.meta.env.DEV) console.error('Prepared query failed:', prepErr);
    throw prepErr;
  }
};

/** Execute a prepared statement with multiple parameter sets in sub-batches. */
export const executeWithReusedStatement = async (
  cypher: string,
  paramsList: Array<Record<string, any>>,
): Promise<void> => {
  if (!connection) await initKuzu();
  if (paramsList.length === 0) return;

  const CHUNK = 4;
  let offset = 0;

  while (offset < paramsList.length) {
    const slice = paramsList.slice(offset, offset + CHUNK);
    const stmt = await connection.prepare(cypher);
    if (!stmt.isSuccess()) {
      const errText = await stmt.getErrorMessage();
      throw new Error(`Prepare failed: ${errText}`);
    }

    try {
      let sIdx = 0;
      while (sIdx < slice.length) {
        await connection.execute(stmt, slice[sIdx]);
        sIdx++;
      }
    } finally {
      await stmt.close();
    }

    offset += CHUNK;
    // Yield between chunks
    if (offset < paramsList.length) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }
};

/** Verify array parameter support in prepared statements. */
export const testArrayParams = async (): Promise<{ success: boolean; error?: string }> => {
  if (!connection) await initKuzu();

  try {
    const sampleVec = Array.from({ length: 384 }, (_, pos) => pos / 384);

    // Find any node for test anchor
    let anchorId: string | null = null;
    for (const tName of NODE_TABLES) {
      try {
        const probe = await connection.query(`MATCH (n:${tName}) RETURN n.id AS id LIMIT 1`);
        const hit = await probe.getNext();
        if (hit) {
          anchorId = hit.id ?? hit[0];
          break;
        }
      } catch { /* try next table */ }
    }

    if (!anchorId) {
      return { success: false, error: 'No nodes found to test with' };
    }

    if (import.meta.env.DEV) console.log('[prowl:kuzu] testing array params with node:', anchorId);

    // Write a test embedding
    const insertCypher = `CREATE (e:${VECTOR_TABLE} {nodeId: $nodeId, embedding: $embedding})`;
    const stmtHandle = await connection.prepare(insertCypher);
    if (!stmtHandle.isSuccess()) {
      const msg = await stmtHandle.getErrorMessage();
      return { success: false, error: `Prepare failed: ${msg}` };
    }

    await connection.execute(stmtHandle, { nodeId: anchorId, embedding: sampleVec });
    await stmtHandle.close();

    // Verify round-trip
    const check = await connection.query(
      `MATCH (e:${VECTOR_TABLE} {nodeId: '${anchorId}'}) RETURN e.embedding AS emb`,
    );
    const checkRow = await check.getNext();
    const stored = checkRow?.emb ?? checkRow?.[0];

    if (stored && Array.isArray(stored) && stored.length === 384) {
      if (import.meta.env.DEV) console.log('[prowl:kuzu] array params work — stored embedding length:', stored.length);
      return { success: true };
    }

    return {
      success: false,
      error: `Embedding not stored correctly. Got: ${typeof stored}, length: ${stored?.length}`,
    };
  } catch (testErr) {
    const detail = testErr instanceof Error ? testErr.message : String(testErr);
    if (import.meta.env.DEV) console.error('[prowl:kuzu] array params test failed:', detail);
    return { success: false, error: detail };
  }
};
