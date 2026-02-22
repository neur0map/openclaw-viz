// Wrapper for isomorphic-git
let isomorphic_gitModule;
async function loadisomorphic_git() {
  if (!isomorphic_gitModule) {
    const module = await import('isomorphic-git');
    isomorphic_gitModule = module.default || module;
  }
  return isomorphic_gitModule;
}

// Export default
export default await loadisomorphic_git();
