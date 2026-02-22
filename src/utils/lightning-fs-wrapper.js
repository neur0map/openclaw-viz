// Wrapper for @isomorphic-git/lightning-fs
let lightning_fsModule;
async function loadlightning_fs() {
  if (!lightning_fsModule) {
    const module = await import('@isomorphic-git/lightning-fs');
    lightning_fsModule = module.default || module;
  }
  return lightning_fsModule;
}

// Export default
export default await loadlightning_fs();
