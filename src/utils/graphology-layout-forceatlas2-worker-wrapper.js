// Wrapper for graphology-layout-forceatlas2/worker
let graphology_layout_forceatlas2_workerModule;
async function loadgraphology_layout_forceatlas2_worker() {
  if (!graphology_layout_forceatlas2_workerModule) {
    const module = await import('graphology-layout-forceatlas2/worker');
    graphology_layout_forceatlas2_workerModule = module.default || module;
  }
  return graphology_layout_forceatlas2_workerModule;
}

// Export default
export default await loadgraphology_layout_forceatlas2_worker();
