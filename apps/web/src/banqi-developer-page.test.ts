import { DEFAULT_NO_PROGRESS_PLY_LIMIT, LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT } from '@mistboard/game';
import { afterEach, expect, it, vi } from 'vitest';
import {
  parseBanqiProviderRequest,
  parseBanqiProviderResponse,
} from '../../server/src/banqi-provider-protocol.js';
import { isClientRoute } from '../../server/src/server-policy.js';
import {
  BANQI_NATIVE_COMMANDS,
  BANQI_PROVIDER_EXAMPLES,
  buildBanqiDeveloperReference,
  mountBanqiDeveloperReference,
  renderBanqiDeveloperShellForPrerender,
} from './banqi-developer-page.js';
import { renderDevelopersShellForPrerender } from './developers-page.js';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, '', '/');
  document.body.replaceChildren();
});

it('renders the exact checked complete payloads and an executable native root list', () => {
  const request = parseBanqiProviderRequest(BANQI_PROVIDER_EXAMPLES.request);
  parseBanqiProviderResponse(BANQI_PROVIDER_EXAMPLES.move, request);
  parseBanqiProviderResponse(BANQI_PROVIDER_EXAMPLES.analysis, request);
  const page = buildBanqiDeveloperReference();
  const blocks = [...page.querySelectorAll('pre')].map((el) => el.textContent);
  for (const example of Object.values(BANQI_PROVIDER_EXAMPLES))
    expect(blocks).toContain(JSON.stringify(example, null, 2));
  expect(BANQI_NATIVE_COMMANDS).toContain(`position fen ${request.repetition.fen}`);
  expect(BANQI_NATIVE_COMMANDS.split('searchmoves ')[1]?.split(' ')).toEqual(request.legalMoves);
  expect(page.textContent).toContain('regenerate absolute Unix-millisecond timestamps');
});

it('offers local anchors, exact public references and bounded claims about new evaluation wiring', () => {
  const page = buildBanqiDeveloperReference();
  for (const id of ['runtime', 'examples', 'analysis', 'rules', 'data']) {
    expect(page.querySelector(`nav a[href="#${id}"]`)).not.toBeNull();
    expect(page.querySelector(`h2#${id}`)).not.toBeNull();
  }
  for (const href of ['/rules/banqi', '/data?variant=banqi', '/data/about', '/contact'])
    expect(page.querySelector(`a[href="${href}"]`)).not.toBeNull();
  expect(page.textContent).toContain(`${DEFAULT_NO_PROGRESS_PLY_LIMIT} plies`);
  expect(page.textContent).toContain(`use ${LEGACY_BANQI_NO_PROGRESS_PLY_LIMIT}`);
  expect(page.textContent).toContain('not automatically a postgame analysis backend');
  expect(page.textContent).toContain('It needs extra searches');
  expect(page.textContent).toContain('win + draw / 2');
  expect(page.querySelector('form, input[type="file"], a[href$=".pdf"]')).toBeNull();
});

it('keeps public copy and samples free of private integration details', () => {
  const html = buildBanqiDeveloperReference().outerHTML;
  expect(html).not.toMatch(
    /private-banqi-worker|banqi-provider-canary|railway\.app|MISTBOARD_.*TOKEN|\/Users\/|\.bqnn/,
  );
  expect(html).toContain('Publishing your engine source or model is not required');
  expect(html).toContain('you do not need to implement the JSON contract');
});

it('copies the full checked payload without issuing a request', async () => {
  const writeText = vi.fn(async () => {});
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  const fetch = vi.fn(() => {
    throw new Error('reference page must not fetch a worker');
  });
  vi.stubGlobal('fetch', fetch);
  const page = buildBanqiDeveloperReference();
  (page.querySelector('[aria-label="Copy Complete JSON request"]') as HTMLButtonElement).click();
  await vi.waitFor(() =>
    expect(writeText).toHaveBeenCalledWith(
      JSON.stringify(BANQI_PROVIDER_EXAMPLES.request, null, 2),
    ),
  );
  expect(fetch).not.toHaveBeenCalled();
});

it('prerenders readable content without data fetches and links from the existing developer page', () => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => {
      throw new Error('prerender must not fetch');
    }),
  );
  const html = renderBanqiDeveloperShellForPrerender('en');
  expect(html).toContain('Connect a Banqi engine');
  expect(html).toContain('mistboard-banqi/1');
  expect(renderDevelopersShellForPrerender('en')).toContain('href="/developers/banqi"');
  for (const locale of ['zh-Hans', 'zh-Hant'] as const)
    expect(renderDevelopersShellForPrerender(locale)).not.toContain('href="/developers/banqi"');
  const root = document.createElement('main');
  mountBanqiDeveloperReference(root);
  expect(root.querySelector('[aria-current="page"][href="/developers"]')).not.toBeNull();
  expect(isClientRoute('/developers/banqi')).toBe(true);
  expect(isClientRoute('/developers/banqi/')).toBe(true);
  for (const path of ['/developers/other', '/developers/banqi/upload', '/zh-hans/developers/banqi'])
    expect(isClientRoute(path)).toBe(false);
});
