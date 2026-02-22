// Wrapper for lowlight/lib/core
let lowlight_lib_coreModule;
async function loadlowlight_lib_core() {
  if (!lowlight_lib_coreModule) {
    const module = await import('lowlight/lib/core');
    lowlight_lib_coreModule = module.default || module;
  }
  return lowlight_lib_coreModule;
}

// Export default
export default await loadlowlight_lib_core();
