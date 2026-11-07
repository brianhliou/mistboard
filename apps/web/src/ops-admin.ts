import { resolveOpsRoute } from './ops-route.js';

export async function mountOps(root: HTMLElement): Promise<void> {
  const route = resolveOpsRoute(new URL(window.location.href));
  if (!route) throw new Error('Unsupported Ops route');
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current !== route.href) window.history.replaceState(null, '', route.href);
  if (route.tab === 'readouts') {
    const { mountReadoutsAdmin } = await import('./readouts-admin.js');
    await mountReadoutsAdmin(root);
  } else {
    const { mountMetrics } = await import('./metrics.js');
    await mountMetrics(root, { admin: true });
  }
}
