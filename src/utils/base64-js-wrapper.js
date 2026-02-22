// Wrapper for base64-js
let base64_jsModule;
async function loadbase64_js() {
  if (!base64_jsModule) {
    const module = await import('base64-js');
    base64_jsModule = module.default || module;
  }
  return base64_jsModule;
}

// Export default
export default await loadbase64_js();
