import louvain from 'graphology-communities-louvain';

// Re-export both default and named exports for compatibility
export default louvain.default || louvain;
