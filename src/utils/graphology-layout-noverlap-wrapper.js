// Wrapper for graphology-layout-noverlap
let graphology_layout_noverlapModule;
async function loadgraphology_layout_noverlap() {
  if (!graphology_layout_noverlapModule) {
    const module = await import('graphology-layout-noverlap');
    graphology_layout_noverlapModule = module.default || module;
  }
  return graphology_layout_noverlapModule;
}

// Export default
export default await loadgraphology_layout_noverlap();
