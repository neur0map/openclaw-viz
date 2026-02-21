// Import the CommonJS module
const lowlightModule = require('lowlight');

// Re-export both default and named exports for compatibility
const lowlight = lowlightModule.default || lowlightModule;
export default lowlight;
