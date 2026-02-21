import camelcase from 'camelcase';

// Re-export both as default and named for compatibility
export default camelcase.default || camelcase;
export const camelCase = camelcase.default || camelcase;
