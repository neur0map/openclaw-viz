import git from 'isomorphic-git';

// Re-export both default and named exports for compatibility
export default git.default || git;
