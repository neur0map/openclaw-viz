// Wrapper for decamelize
let decamelizeModule;
async function loaddecamelize() {
  if (!decamelizeModule) {
    const module = await import('decamelize');
    decamelizeModule = module.default || module;
  }
  return decamelizeModule;
}

// Export default
export default await loaddecamelize();
