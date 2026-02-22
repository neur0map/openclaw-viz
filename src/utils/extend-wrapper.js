// Wrapper for extend
let extendModule;
async function loadextend() {
  if (!extendModule) {
    const module = await import('extend');
    extendModule = module.default || module;
  }
  return extendModule;
}

// Export default
export default await loadextend();
