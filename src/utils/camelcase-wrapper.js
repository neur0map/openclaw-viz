// Wrapper for camelcase
let camelcaseModule;
async function loadcamelcase() {
  if (!camelcaseModule) {
    const module = await import('camelcase');
    camelcaseModule = module.default || module;
  }
  return camelcaseModule;
}

// Export default
export default await loadcamelcase();
