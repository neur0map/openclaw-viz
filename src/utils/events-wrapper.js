// Wrapper for events - provides both named and default exports
let eventsModule;

async function loadEvents() {
  if (!eventsModule) {
    const module = await import('events');
    eventsModule = module.default || module;
  }
  return eventsModule;
}

const loaded = await loadEvents();

// Re-export as both default and named export for compatibility
export const { EventEmitter } = loaded;
export default loaded;
