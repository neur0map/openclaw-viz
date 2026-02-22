// Wrapper for graphology-utils/is-graph
let graphology_utils_is_graphModule;
async function loadgraphology_utils_is_graph() {
  if (!graphology_utils_is_graphModule) {
    const module = await import('graphology-utils/is-graph');
    graphology_utils_is_graphModule = module.default || module;
  }
  return graphology_utils_is_graphModule;
}

// Export default
export default await loadgraphology_utils_is_graph();
