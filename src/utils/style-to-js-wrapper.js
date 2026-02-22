// Wrapper for style-to-js
let style_to_jsModule;
async function loadstyle_to_js() {
  if (!style_to_jsModule) {
    const module = await import('style-to-js');
    style_to_jsModule = module.default || module;
  }
  return style_to_jsModule;
}

// Export default
export default await loadstyle_to_js();
