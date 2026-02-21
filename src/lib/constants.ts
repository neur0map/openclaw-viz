import { NodeLabel } from '../core/graph/types';

const NODE_CONFIG: { label: NodeLabel; color: string; size: number }[] = [
  { label: 'Project',     color: '#D4A868', size: 10 },
  { label: 'Package',     color: '#C0986C', size: 8 },
  { label: 'Module',      color: '#A09880', size: 7 },
  { label: 'Folder',      color: '#D4A868', size: 6 },
  { label: 'File',        color: '#6AAAD4', size: 5 },
  { label: 'Class',       color: '#D08060', size: 7 },
  { label: 'Function',    color: '#88B878', size: 4 },
  { label: 'Method',      color: '#60B8A0', size: 4 },
  { label: 'Variable',    color: '#808080', size: 2 },
  { label: 'Interface',   color: '#C080A0', size: 6 },
  { label: 'Enum',        color: '#CCA060', size: 5 },
  { label: 'Decorator',   color: '#C89860', size: 2 },
  { label: 'Import',      color: '#808080', size: 2 },
  { label: 'Type',        color: '#A088B8', size: 4 },
  { label: 'CodeElement', color: '#808080', size: 2 },
  { label: 'Community',   color: '#D4A868', size: 0 },
  { label: 'Process',     color: '#C87070', size: 0 },
];

export const NODE_COLORS: Record<NodeLabel, string> = NODE_CONFIG.reduce(
  (acc, { label, color }) => { acc[label] = color; return acc; },
  {} as Record<NodeLabel, string>,
);

export const NODE_SIZES: Record<NodeLabel, number> = NODE_CONFIG.reduce(
  (acc, { label, size }) => { acc[label] = size; return acc; },
  {} as Record<NodeLabel, number>,
);

export const MODULE_PALETTE = [
  '#6AAAD4',
  '#D08060',
  '#88B878',
  '#CCA060',
  '#60B8A0',
  '#D4A868',
  '#A088B8',
  '#6098B0',
  '#C080A0',
  '#70B898',
  '#C87070',
  '#60B0B8',
  '#C89860',
  '#B89068',
  '#9080A8',
  '#C89860',
];

export const getModuleColor = (communityIndex: number): string => {
  return MODULE_PALETTE[communityIndex % MODULE_PALETTE.length];
};

export const DEFAULT_VISIBLE_LABELS: NodeLabel[] = [
  'Project',
  'Package',
  'Module',
  'Folder',
  'File',
  'Class',
  'Function',
  'Method',
  'Interface',
  'Enum',
  'Type',
];

export const FILTERABLE_LABELS: NodeLabel[] = [
  'Folder',
  'File',
  'Class',
  'Function',
  'Method',
  'Variable',
  'Interface',
  'Import',
];

export type EdgeType = 'CONTAINS' | 'DEFINES' | 'IMPORTS' | 'CALLS' | 'EXTENDS' | 'IMPLEMENTS';

export const ALL_EDGE_TYPES: EdgeType[] = [
  'CONTAINS',
  'DEFINES',
  'IMPORTS',
  'CALLS',
  'EXTENDS',
  'IMPLEMENTS',
];

export const DEFAULT_VISIBLE_EDGES: EdgeType[] = [
  'CONTAINS',
  'DEFINES',
  'IMPORTS',
  'EXTENDS',
  'IMPLEMENTS',
  'CALLS',
];

export const EDGE_INFO: Record<EdgeType, { color: string; label: string }> = {
  CONTAINS:   { color: '#689878', label: 'Contains' },
  DEFINES:    { color: '#6098B0', label: 'Defines' },
  IMPORTS:    { color: '#9080A8', label: 'Imports' },
  CALLS:      { color: '#B08090', label: 'Calls' },
  EXTENDS:    { color: '#C08870', label: 'Extends' },
  IMPLEMENTS: { color: '#B07088', label: 'Implements' },
};
