import decamelize from 'decamelize';

// Re-export both as default and named for compatibility
export default decamelize.default || decamelize;
export const snakeCase = decamelize.default || decamelize;
