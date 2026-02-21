import base64 from 'base64-js';

// Re-export both default and named exports for compatibility
export default base64.default || base64;
export const { fromByteArray, toByteArray } = base64.default || base64;
