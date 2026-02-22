// Wrapper for graphology-layout-forceatlas2
let graphology_layout_forceatlas2Module;
async function loadgraphology_layout_forceatlas2() {
  if (!graphology_layout_forceatlas2Module) {
    const module = await import('graphology-layout-forceatlas2');
    graphology_layout_forceatlas2Module = module.default || module;
  }
  return graphology_layout_forceatlas2Module;
}

// Export default
export default await loadgraphology_layout_forceatlas2();
