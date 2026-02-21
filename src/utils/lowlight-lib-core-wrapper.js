// Import real core module
const coreModule = require('lowlight/lib/core');

// Re-export both default and named exports for compatibility
const core = coreModule.default || coreModule;
export default core;
