import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import * as BufferModule from 'buffer';
import App from './App';
import './index.css';

// isomorphic-git depends on Node's Buffer API
const Buffer = BufferModule.Buffer || BufferModule;
if (!globalThis.Buffer) globalThis.Buffer = Buffer;

const container = document.getElementById('root');
if (!container) throw new Error('Root element not found');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
