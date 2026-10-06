import React, { useState } from 'react';
import { CollegeBrand } from './CollegeBrand';

export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    building: <path d="m3 8 9-5 9 5M3 21h18M5 10v8m5-8v8m4-8v8m5-8v8M3 8h18" />,
    shield: <><path d="m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z" /><path d="m8 12 3 3 5-6" /></>,
    intake: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="M8 8h2m4 0h2M8 12h2m4 0h2M8 16h2m4 0h2" /></>,
    check: <><rect x="4" y="4" width="16" height="16" rx="1" /><path d="m8 11 2 2 5-5M8 17h8" /></>,
    chart: <path d="M3 21h18M5 20V10h4v10m0 0V4h4v16m0 0v-7h4v7" />,
    nodes: <><rect x="3" y="3" width="5" height="5" /><rect x="16" y="8" width="5" height="5" /><rect x="3" y="16" width="5" height="5" /><path d="M8 5h4v14H8m4-9h4" /></>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3m-4 5v2" /></>,
    users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-16a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v2" /></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5" /><path d="M5 8a8 8 0 0 1 13-3l2 3M4 16l2 3a8 8 0 0 0 13-3" /></>,
    search: <><circle cx="10" cy="10" r="6" /><path d="m15 15 6 6" /></>,
    arrow: <path d="M5 12h14m-6-6 6 6-6 6" />,
    play: <><circle cx="12" cy="12" r="9" /><path d="m10 8 6 4-6 4z" /></>,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    logout: <path d="M9 3H3v18h6m7-15 6 6-6 6m-9-6h15" />,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.nodes}</svg>;
}
export type NavItem = { label: string; icon: string; href?: string; onClick?: () => void; active?: boolean };
export function WorkspaceShell({ children, items = [], account, role, cycle, actions, onSignOut, student = false }: {
  children: React.ReactNode; items?: NavItem[]; account: string; role: string; cycle?: string;
  actions?: React.ReactNode; onSignOut: () => void; student?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [activeHref, setActiveHref] = useState('#overview');
  const initials = account.split(/[@ ._-]/).filter(Boolean).slice(0, 2).map(s => s[0]).join('').toUpperCase();
  return <div className={`workspace ${student ? 'studentWorkspace' : ''}`}>
    <header className="workspaceTopbar">
      {!student && <button className="iconButton mobileMenu" aria-label="Toggle navigation" aria-expanded={open} onClick={() => setOpen(!open)}><Icon name="menu" /></button>}
      <a className="workspaceBrand" href="#overview" aria-label="St. Joseph’s selection portal home"><CollegeBrand portal={student ? 'Student Portal · PEP / HOPE' : 'Selection & Allocation · PEP / HOPE'} /></a>
      <div className="cycleChip"><span className="dot" />{cycle ? 'Active selection cycle' : 'Selection workspace'}{cycle && <small title={cycle}>{cycle}</small>}</div>
      <div className="topbarActions">{actions}</div>
      <div className="accountIdentity"><span className="avatar">{initials || 'P9'}</span><span title={account}><b>{account}</b><small>{role}</small></span></div>
      <button className="iconButton" title="Sign out" aria-label="Sign out" onClick={onSignOut}><Icon name="logout" /></button>
    </header>
    {!student && <aside className={`workspaceSidebar ${open ? 'isOpen' : ''}`}>
      <a className="cycleCommand" href="#overview" onClick={() => setOpen(false)}><Icon name="shield" size={25} /><span><b>Selection Portal</b><small>PEP / HOPE selection</small></span></a>
      <nav aria-label="Workspace navigation">{items.map(item => <a key={item.label} className={(item.href ? item.href === activeHref : item.active) ? 'active' : ''} href={item.href ?? '#'} onClick={event => { if (item.onClick) { event.preventDefault(); item.onClick(); } if (item.href) setActiveHref(item.href); setOpen(false); }}><Icon name={item.icon} /><span>{item.label}</span></a>)}</nav>
      <div className="sidebarFooter"><Icon name="shield" /><b>Faculty approval required</b><p>Authorized reviewers approve allocations within their assigned domains.</p><small>St. Joseph’s · PEP / HOPE</small></div>
    </aside>}
    <main className="workspaceMain">{children}<footer className="workspaceFooter"><span><Icon name="shield" size={15} />Role-based access enforced</span><span>Selection records · Auditable decisions</span><a href="https://stjosephs.ac.in/" target="_blank" rel="noopener noreferrer">College website ↗</a></footer></main>
  </div>;
}
