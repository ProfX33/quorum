import { useEffect, useState } from 'react';

// Light and dark daisyUI themes (see index.css). index.html applies the saved one before first paint.
export const THEMES = { light: 'market', dark: 'market-dark' };
const KEY = 'theme';
const META_COLORS = { light: '#F1EFEA', dark: '#121110' };

function initialMode() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {}
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

/** Returns [mode, toggle]; the choice is remembered per browser. */
export function useTheme() {
  const [mode, setMode] = useState(initialMode);
  useEffect(() => {
    document.documentElement.dataset.theme = THEMES[mode];
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLORS[mode]);
    try { localStorage.setItem(KEY, mode); } catch {}
  }, [mode]);
  return [mode, () => setMode((m) => (m === 'dark' ? 'light' : 'dark'))];
}
