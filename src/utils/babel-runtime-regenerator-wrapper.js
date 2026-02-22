// Wrapper for babel-runtime-regenerator
let babel_runtime_regeneratorModule;
async function loadbabel_runtime_regenerator() {
  if (!babel_runtime_regeneratorModule) {
    const module = await import('babel-runtime-regenerator');
    babel_runtime_regeneratorModule = module.default || module;
  }
  return babel_runtime_regeneratorModule;
}

// Export default
export default await loadbabel_runtime_regenerator();
