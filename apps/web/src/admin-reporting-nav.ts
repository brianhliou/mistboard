// Mounted only after a successful admin-only reporting response.
import './admin-reporting-nav.css';
import type { OpsTab } from './ops-route.js';
export type ReportingTab = OpsTab;
export function buildReportingNav(active: ReportingTab): HTMLElement {
  const nav = document.createElement('nav');
  nav.className = 'admin-reporting-nav';
  nav.setAttribute('aria-label', 'Ops sections');
  const week = new URLSearchParams(window.location.search).get('week');
  for (const [tab, label] of [
    ['readouts', 'Readouts'],
    ['play', 'Games'],
    ['retention', 'Returning players'],
    ['activity', 'Activity'],
    ['operations', 'System'],
  ] as const) {
    const link = document.createElement('a');
    const query = new URLSearchParams();
    if (tab !== 'readouts') query.set('tab', tab);
    if (week && /^\d{4}-\d{2}-\d{2}$/.test(week)) query.set('week', week);
    const search = query.toString();
    link.href = `/ops${search ? `?${search}` : ''}`;
    link.textContent = label;
    if (tab === active) link.setAttribute('aria-current', 'page');
    nav.append(link);
  }
  return nav;
}
