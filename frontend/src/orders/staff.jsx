import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from './api.js';
import { hasRole, isAdmin } from './flowUi.js';

// Who is using Order Analytics. There is no separate login: the person signed in on the hub, and the server turns that into their
// desk identity (name, Admin / Confirmation / Dispatch). Every action in the desks is stamped with that person.
const Ctx = createContext(null);

export function StaffProvider({ children }) {
  const { logout } = useAuth();
  const [state, setState] = useState({ user: null, loading: true, error: null, slow: false });

  const open = useCallback(() => {
    let live = true;
    setState({ user: null, loading: true, error: null, slow: false });
    // A free-tier server that went to sleep can take most of a minute to answer: say so instead of looking stuck.
    const slowTimer = setTimeout(() => live && setState((s) => (s.loading ? { ...s, slow: true } : s)), 3500);
    api.get('/staff/me').then(
      (r) => { if (live) setState({ user: r.user, loading: false, error: null, slow: false }); },
      (error) => { if (live) setState({ user: null, loading: false, error, slow: false }); },
    ).finally(() => clearTimeout(slowTimer));
    return () => { live = false; clearTimeout(slowTimer); };
  }, []);

  useEffect(() => open(), [open]);

  const value = useMemo(() => ({ ...state, logout, retry: open }), [state, logout, open]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useStaff = () => useContext(Ctx);

// What this person may do. The server enforces the same rules; this only decides which buttons to show.
export const can = (user, what) => !!user && (isAdmin(user) || hasRole(user, what));
