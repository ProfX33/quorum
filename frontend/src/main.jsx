import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App';

// The spotlight on panels follows the cursor (see .panel in index.css).
document.addEventListener('pointermove', (e) => {
  const panel = e.target.closest?.('.card-border, .panel');
  if (!panel) return;
  const rect = panel.getBoundingClientRect();
  panel.style.setProperty('--mx', `${e.clientX - rect.left}px`);
  panel.style.setProperty('--my', `${e.clientY - rect.top}px`);
});

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>
);
