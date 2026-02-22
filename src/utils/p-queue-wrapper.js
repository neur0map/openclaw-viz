// Wrapper for p-queue
let p_queueModule;
async function loadp_queue() {
  if (!p_queueModule) {
    const module = await import('p-queue');
    p_queueModule = module.default || module;
  }
  return p_queueModule;
}

// Export default
export default await loadp_queue();
