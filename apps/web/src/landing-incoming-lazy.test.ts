import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildLandingIncomingChallenges } from './landing-correspondence-moves.js';
import { setResolvedSignedIn } from './signed-in-state.js';

// The homepage reads incoming challenges itself and loads the correspondence
// page's code (a large chunk with its own stylesheets) only when one waits.
const render = vi.hoisted(() => vi.fn(async () => {}));
const loaded = vi.hoisted(() => vi.fn());
vi.mock('./correspondence.js', () => {
  loaded();
  return { renderIncomingChallenges: render };
});

const response = (body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  setResolvedSignedIn(false);
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  render.mockClear();
});

describe('homepage incoming challenges', () => {
  it('does not load the correspondence page code when no challenge waits', async () => {
    const fetchMock = vi.fn(async () => response({ challenges: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const box = buildLandingIncomingChallenges();
    document.body.append(box);
    setResolvedSignedIn(true);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await new Promise((done) => setTimeout(done, 0));
    expect(box.hidden).toBe(true);
    expect(loaded).not.toHaveBeenCalled();
    expect(render).not.toHaveBeenCalled();
  });

  it('hands the challenges it read to the shared renderer without a second read', async () => {
    const challenge = { id: 'incoming-1', gameSpecId: 'xiangqi', daysPerMove: 3 };
    const fetchMock = vi.fn(async () => response({ challenges: [challenge] }));
    vi.stubGlobal('fetch', fetchMock);
    const box = buildLandingIncomingChallenges();
    document.body.append(box);
    setResolvedSignedIn(true);
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(1));
    expect(render.mock.calls[0]).toEqual([
      box,
      undefined,
      expect.objectContaining({ compact: true, challenges: [challenge] }),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
