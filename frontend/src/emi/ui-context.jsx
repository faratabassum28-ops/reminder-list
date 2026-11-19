import { createContext, useCallback, useContext, useRef, useState } from 'react';
import { useTheme as useHubTheme } from '../context/ThemeContext.jsx';

/* ---------- theme: the hub's own light / dark switch (one setting for the whole suite) ---------- */
export function useTheme() {
  const { theme, toggleTheme } = useHubTheme();
  return { theme, toggle: toggleTheme };
}

/* ---------- toasts ---------- */
const ToastCtx = createContext({ push: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const id = useRef(0);
  const push = useCallback((text, tone = 'good', ms = 3600) => {
    const k = ++id.current;
    setItems((l) => [...l.slice(-3), { k, text, tone }]);
    setTimeout(() => setItems((l) => l.filter((x) => x.k !== k)), ms);
  }, []);
  const api = useRef({ push });
  api.current.push = push;
  return (
    <ToastCtx.Provider value={api.current}>
      {children}
      <div className="emi-toast-stack" aria-live="polite">{items.map((t) => <div key={t.k} className={`emi-toast emi-toast-${t.tone}`}>{t.text}</div>)}</div>
    </ToastCtx.Provider>
  );
}

// The hub shows its own connection banner on every screen, so EMI needs none.
export function NetworkBanner() { return null; }
