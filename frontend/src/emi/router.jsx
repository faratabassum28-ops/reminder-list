// EMI Manager lives under /emi inside the hub, but its screens were written with root-relative links ("/tracker", "/p/..").
// These thin wrappers add the /emi prefix, so the screens stay exactly as they were built and deep links keep working.
import React from 'react';
import { Link as RLink, NavLink as RNavLink, Navigate as RNavigate, useNavigate as useRNavigate } from 'react-router-dom';

export const EMI_BASE = '/emi';
export const to = (p) => (typeof p === 'string' && p.startsWith('/') && p !== EMI_BASE && !p.startsWith(`${EMI_BASE}/`) && !p.startsWith(`${EMI_BASE}?`) ? (p === '/' ? EMI_BASE : EMI_BASE + p) : p);

export const Link = React.forwardRef(({ to: t, ...rest }, ref) => <RLink ref={ref} to={to(t)} {...rest} />);
// The stylesheet's "active" class is called emi-active here (so it cannot clash with the hub's), so the active state is added by hand.
export const NavLink = React.forwardRef(({ to: t, className, ...rest }, ref) => (
  <RNavLink ref={ref} to={to(t)} className={({ isActive }) => [typeof className === 'function' ? className({ isActive }) : className, isActive ? 'emi-active' : ''].filter(Boolean).join(' ')} {...rest} />
));
export const Navigate = ({ to: t, ...rest }) => <RNavigate to={to(t)} {...rest} />;
export function useNavigate() {
  const nav = useRNavigate();
  return React.useCallback((t, opts) => (typeof t === 'number' ? nav(t) : nav(to(t), opts)), [nav]);
}
export { Outlet, Route, Routes, useParams, useSearchParams, useLocation } from 'react-router-dom';
