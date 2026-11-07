export type OpsTab = 'readouts' | 'play' | 'retention' | 'activity' | 'operations';

/** One canonical Ops URL; old report links preserve their section, week and anchor. */
export function resolveOpsRoute(input: URL): { tab: OpsTab; href: string } | null {
  const path = input.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/ops' && path !== '/readouts' && path !== '/metrics') return null;
  const url = new URL(input.href);
  const requested = url.searchParams.get('tab');
  let tab: OpsTab;
  switch (requested) {
    case 'readouts':
    case 'play':
    case 'retention':
    case 'activity':
    case 'operations':
      tab = requested;
      break;
    default:
      tab =
        url.hash === '#deploy-history' ? 'operations' : path === '/metrics' ? 'play' : 'readouts';
  }
  url.pathname = '/ops';
  url.searchParams.delete('tab');
  if (tab !== 'readouts') url.searchParams.set('tab', tab);
  return { tab, href: `${url.pathname}${url.search}${url.hash}` };
}
