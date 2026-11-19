import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api';
import { useAuth as useHubAuth } from '../context/AuthContext.jsx';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

// Signing in is the hub's job. This asks the server who the signed-in person is INSIDE EMI Manager (role, "can verify payments",
// batch restriction) - the server is the authority on that - and exposes the same `can` flags the screens already use.
export function EmiAuthProvider({ children }) {
  const hub = useHubAuth();
  const [user, setUser] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    api.get('/auth/me').then((r) => live && setUser(r.user)).catch((e) => live && setError(e.message));
    return () => { live = false; };
  }, [hub.user?.id]);

  const role = user && user.role;
  const can = {
    write: ['Admin', 'Manager', 'CRM'].includes(role),
    manage: ['Admin', 'Manager'].includes(role),
    admin: role === 'Admin',
    verify: !!(user && user.can_verify),
    export: ['Admin', 'Manager', 'Viewer'].includes(role),
  };
  return <Ctx.Provider value={{ user, ready: !!user || !!error, error, logout: hub.logout, can }}>{children}</Ctx.Provider>;
}
