/**
 * Entry-point scoring: ranks functions by four weighted signals --
 * call ratio, export visibility, name pattern matching, and
 * framework-specific path multipliers.
 */

import { detectFrameworkFromPath } from './framework-detection';

// -- Penalty patterns (utility/helper names) ---------------------------------

const PENALTY_PATTERNS: RegExp[] = [
  /^(get|set|is|has|can|should|will|did)[A-Z]/,
  /^_/,
  /^(format|parse|validate|convert|transform)/i,
  /^(log|debug|error|warn|info)$/i,
  /^(to|from)[A-Z]/,
  /^(encode|decode)/i,
  /^(serialize|deserialize)/i,
  /^(clone|copy|deep)/i,
  /^(merge|extend|assign)/i,
  /^(filter|map|reduce|sort|find)/i,
  /Helper$/,
  /Util$/,
  /Utils$/,
  /^utils?$/i,
  /^helpers?$/i,
];

// -- Positive patterns keyed by language -------------------------------------

const POSITIVE_PATTERNS: Record<string, RegExp[]> = {
  '*': [
    /^(main|init|bootstrap|start|run|setup|configure)$/i,
    /^handle[A-Z]/,
    /^on[A-Z]/,
    /Handler$/,
    /Controller$/,
    /^process[A-Z]/,
    /^execute[A-Z]/,
    /^perform[A-Z]/,
    /^dispatch[A-Z]/,
    /^trigger[A-Z]/,
    /^fire[A-Z]/,
    /^emit[A-Z]/,
  ],
  'javascript': [/^use[A-Z]/],
  'typescript': [/^use[A-Z]/],
  'python': [
    /^app$/,
    /^(get|post|put|delete|patch)_/i,
    /^api_/,
    /^view_/,
  ],
  'java': [
    /^do[A-Z]/,
    /^create[A-Z]/,
    /^build[A-Z]/,
    /Service$/,
  ],
  'csharp': [
    /^(Get|Post|Put|Delete)/,
    /Action$/,
    /^On[A-Z]/,
    /Async$/,
  ],
  'go': [
    /Handler$/,
    /^Serve/,
    /^New[A-Z]/,
    /^Make[A-Z]/,
  ],
  'rust': [
    /^(get|post|put|delete)_handler$/i,
    /^handle_/,
    /^new$/,
    /^run$/,
    /^spawn/,
  ],
  'c': [
    /^main$/,
    /^init_/,
    /^start_/,
    /^run_/,
  ],
  'cpp': [
    /^main$/,
    /^init_/,
    /^Create[A-Z]/,
    /^Run$/,
    /^Start$/,
  ],
};

// -- Types -------------------------------------------------------------------

export interface EntryPointScoreResult {
  score: number;
  reasons: string[];
}

// -- Scoring logic -----------------------------------------------------------

/** Composite entry-point score with human-readable reason tags. */
export function calculateEntryPointScore(
  name: string,
  language: string,
  isExported: boolean,
  callerCount: number,
  calleeCount: number,
  filePath: string = '',
): EntryPointScoreResult {
  const tags: string[] = [];

  // No outgoing calls = cannot anchor a trace
  if (calleeCount === 0) {
    return { score: 0, reasons: ['no-outgoing-calls'] };
  }

  // Signal 1 -- call ratio
  const ratio = calleeCount / (callerCount + 1);
  tags.push(`base:${ratio.toFixed(2)}`);

  // Signal 2 -- export boost
  const exportFactor = isExported ? 2.0 : 1.0;
  if (isExported) tags.push('exported');

  // Signal 3 -- name pattern matching
  let nameFactor = 1.0;
  const matchesPenalty = PENALTY_PATTERNS.some((rx) => rx.test(name));

  if (matchesPenalty) {
    nameFactor = 0.3;
    tags.push('utility-pattern');
  } else {
    const global = POSITIVE_PATTERNS['*'] ?? [];
    const langSpecific = POSITIVE_PATTERNS[language] ?? [];
    const combined = global.concat(langSpecific);

    if (combined.some((rx) => rx.test(name))) {
      nameFactor = 1.5;
      tags.push('entry-pattern');
    }
  }

  // Signal 4 -- framework detection
  let frameworkFactor = 1.0;
  if (filePath) {
    const hint = detectFrameworkFromPath(filePath);
    if (hint) {
      frameworkFactor = hint.entryPointMultiplier;
      tags.push(`framework:${hint.reason}`);
    }
  }

  const composite = ratio * exportFactor * nameFactor * frameworkFactor;

  return { score: composite, reasons: tags };
}

// -- File classification -----------------------------------------------------

/** Check if a path looks like a test file (JS/TS, Python, Go, Java, Rust, C#). */
export function isTestFile(filePath: string): boolean {
  const norm = filePath.toLowerCase().replace(/\\/g, '/');

  const markers = [
    '.test.',
    '.spec.',
    '__tests__/',
    '__mocks__/',
    '/test/',
    '/tests/',
    '/testing/',
    '/src/test/',
    '.tests/',
    'tests.cs',
  ];

  if (markers.some((m) => norm.includes(m))) return true;
  if (norm.endsWith('_test.py')) return true;
  if (norm.endsWith('_test.go')) return true;
  if (norm.includes('/test_')) return true;

  return false;
}

/** Check if a path is inside a utility/helper directory. */
export function isUtilityFile(filePath: string): boolean {
  const norm = filePath.toLowerCase().replace(/\\/g, '/');

  const directoryMarkers = [
    '/utils/', '/util/', '/helpers/', '/helper/',
    '/common/', '/shared/', '/lib/',
  ];

  const suffixMarkers = [
    '/utils.ts', '/utils.js', '/helpers.ts', '/helpers.js',
    '_utils.py', '_helpers.py',
  ];

  return (
    directoryMarkers.some((d) => norm.includes(d)) ||
    suffixMarkers.some((s) => norm.endsWith(s))
  );
}
