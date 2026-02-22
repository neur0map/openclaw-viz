// Wrapper for lowlight
let lowlightModule;
async function loadlowlight() {
  if (!lowlightModule) {
    const module = await import('lowlight');
    lowlightModule = module.default || module;
  }
  return lowlightModule;
}

// Export default
export default await loadlowlight();
