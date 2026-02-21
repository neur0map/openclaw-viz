// Wrapper to handle graphology's named import of EventEmitter from CommonJS events module
import events from 'events';

// Re-export as both default and named export for compatibility
export const EventEmitter = events.default || events;
export default events.default || events;
