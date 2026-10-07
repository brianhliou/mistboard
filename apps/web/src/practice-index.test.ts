import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountPracticeIndex, practiceSetTarget } from './practice-index.js';

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.replaceChildren();
  window.history.replaceState({}, '', '/');
});

// The shelf is the surface that was English while every study behind it was
// translated, so what is asserted here is where each string comes FROM: a card
// names a study and must say what that study is called, in the reader's locale.

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function practiceResponse(card: Record<string, unknown>): Response {
  return jsonResponse({
    sections: [
      {
        id: 'endgames',
        title: 'Basic endgames',
        cards: [
          {
            slug: 'endgames-horse',
            title: 'Horse endgames',
            blurb: 'Slow, and blockable',
            studyId: 'PNqQaTM6',
            exerciseCount: 6,
            solvedCount: 0,
            ...card,
          },
        ],
      },
    ],
  });
}

async function mount(response: Response): Promise<HTMLElement> {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => response),
  );
  const root = document.createElement('div');
  document.body.append(root);
  mountPracticeIndex(root);
  await vi.waitFor(() => expect(root.querySelector('.learn-xq-tile h3')).not.toBeNull());
  return root;
}

describe('practice shelf', () => {
  it('names a card after its study, not after the catalogue', async () => {
    const root = await mount(
      practiceResponse({
        name: 'Horse endgames, renamed',
        description: 'The study says this',
      }),
    );
    expect(root.querySelector('.learn-xq-tile h3')?.textContent).toBe('Horse endgames, renamed');
    expect(root.querySelector('.learn-xq-tile p')?.textContent).toBe('The study says this');
  });

  it("renders the study's own locale overlay", async () => {
    window.history.replaceState({}, '', '/zh-hans/practice');
    const root = await mount(
      practiceResponse({
        name: 'Horse endgames',
        description: 'Slow, and blockable',
        i18n: {
          'zh-Hans': { name: '马类残局', description: '马走得慢，还会被蹩腿。' },
          'zh-Hant': { name: '馬類殘局', description: '馬走得慢，還會被蹩腿。' },
        },
      }),
    );
    expect(root.querySelector('.learn-xq-tile h3')?.textContent).toBe('马类残局');
    expect(root.querySelector('.learn-xq-tile p')?.textContent).toBe('马走得慢，还会被蹩腿。');
  });

  it('falls back to the catalogue when the response carries no study text', async () => {
    // A client cached before the study text was added to /api/practice. It gets
    // the English card rather than a blank one.
    const root = await mount(practiceResponse({}));
    expect(root.querySelector('.learn-xq-tile h3')?.textContent).toBe('Horse endgames');
    expect(root.querySelector('.learn-xq-tile p')?.textContent).toBe('Slow, and blockable');
  });

  it('falls back to the served English for a section id it has no key for', async () => {
    const root = await mount(
      jsonResponse({
        sections: [
          {
            id: 'openings',
            title: 'Openings',
            cards: [
              {
                slug: 'openings-cannon',
                title: 'Cannon openings',
                blurb: 'blurb',
                studyId: 'x',
                exerciseCount: 1,
                solvedCount: 0,
              },
            ],
          },
        ],
      }),
    );
    expect(root.querySelector('.learn-xq-categ h2')?.textContent).toBe('Openings');
  });
});

describe('practiceSetTarget', () => {
  const sections = [
    {
      id: 'endgames',
      title: 'Basic endgames',
      cards: [
        {
          slug: 'endgames-wins-and-draws',
          title: 'Wins and draws',
          blurb: 'b',
          studyId: 'abc123',
          exerciseCount: 26,
          solvedCount: 0,
        },
      ],
    },
  ];

  it('sends ?set=<slug> to the study the slug resolves to', () => {
    expect(practiceSetTarget(sections, '?set=endgames-wins-and-draws')).toBe('/study/abc123');
  });

  it('shows the shelf for no slug or one the catalogue does not resolve', () => {
    expect(practiceSetTarget(sections, '')).toBeNull();
    expect(practiceSetTarget(sections, '?set=endgames-unseeded')).toBeNull();
  });
});
