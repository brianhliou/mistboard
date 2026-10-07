import { PRACTICE_SECTIONS } from '@mistboard/game';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  mountPracticeIndex,
  nextPracticeSlug,
  type PracticeSectionDto,
  practiceSetTarget,
  practiceTileState,
} from './practice-index.js';

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
            blurb: 'Mind the blocked leg',
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
  it("names a card after its study, but keeps the shelf's short subtitle", async () => {
    // The study's description is a paragraph for the study page; the card is a
    // title and a few words, and must not grow back into the description.
    const root = await mount(
      practiceResponse({
        name: 'Horse endgames, renamed',
        description: 'The horse is slow and its leg can be blocked. Converting is timing.',
      }),
    );
    expect(root.querySelector('.learn-xq-tile h3')?.textContent).toBe('Horse endgames, renamed');
    expect(root.querySelector('.learn-xq-tile p')?.textContent).toBe('Mind the blocked leg');
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
    expect(root.querySelector('.learn-xq-tile p')?.textContent).toBe('当心蹩马腿');
  });

  it('falls back to the catalogue when the response carries no study text', async () => {
    // A client cached before the study text was added to /api/practice. It gets
    // the English card rather than a blank one.
    const root = await mount(practiceResponse({}));
    expect(root.querySelector('.learn-xq-tile h3')?.textContent).toBe('Horse endgames');
    expect(root.querySelector('.learn-xq-tile p')?.textContent).toBe('Mind the blocked leg');
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
    // And a slug with no subtitle key shows the catalogue's English.
    expect(root.querySelector('.learn-xq-tile p')?.textContent).toBe('blurb');
  });

  it("renders every catalogue card's English subtitle as the catalogue states it", async () => {
    // The English lives twice, in the catalogue (the fallback) and in the app
    // catalog (the localized key); this keeps them the same words.
    const sections = PRACTICE_SECTIONS.map((section) => ({
      ...section,
      cards: section.cards.map((card) => ({
        ...card,
        studyId: card.slug,
        exerciseCount: 4,
        solvedCount: 0,
      })),
    }));
    const root = await mount(jsonResponse({ sections }));
    const shown = [...root.querySelectorAll('.learn-xq-tile p')].map((p) => p.textContent);
    expect(shown).toEqual(PRACTICE_SECTIONS.flatMap((s) => s.cards.map((card) => card.blurb)));
  });

  it('does not link the rail off to the blog', async () => {
    // Practice is linked FROM the endgames article; it does not send a learner
    // back out to it.
    const root = await mount(practiceResponse({}));
    const side = root.querySelector('.learn-xq-side-card');
    expect(side).not.toBeNull();
    expect(side?.querySelector('a')).toBeNull();
    expect(root.querySelector('a[href*="/blog/"]')).toBeNull();
  });

  it('marks the first card Play! with the ring, and shows the rest by size', async () => {
    const root = await mount(
      jsonResponse({
        sections: [
          {
            id: 'endgames',
            title: 'Basic endgames',
            cards: [
              {
                slug: 'endgames-wins-and-draws',
                title: 'A',
                blurb: 'a',
                studyId: 'a',
                exerciseCount: 26,
                solvedCount: 0,
              },
              {
                slug: 'endgames-soldier',
                title: 'B',
                blurb: 'b',
                studyId: 'b',
                exerciseCount: 11,
                solvedCount: 0,
              },
            ],
          },
        ],
      }),
    );
    const [first, second] = root.querySelectorAll<HTMLElement>('.learn-xq-tile');
    expect(first?.classList.contains('learn-xq-tile--ongoing')).toBe(true);
    expect(first?.querySelector('.learn-xq-ribbon')?.textContent).toBe('Play!');
    expect(first?.querySelector('.learn-xq-tile-ring')).not.toBeNull();
    // Nothing solved yet, so no progress line to draw.
    expect(first?.querySelector('.learn-xq-tile-line')).toBeNull();
    expect(second?.classList.contains('learn-xq-tile--future')).toBe(true);
    expect(second?.querySelector('.learn-xq-ribbon')?.textContent).toBe('0 / 11');
    expect(second?.querySelector('.learn-xq-tile-ring')).toBeNull();
  });

  it('draws the progress line on a set in progress, filled to the solved share', async () => {
    const root = await mount(practiceResponse({ solvedCount: 3 }));
    const card = root.querySelector<HTMLElement>('.learn-xq-tile');
    expect(card?.classList.contains('learn-xq-tile--ongoing')).toBe(true);
    expect(card?.querySelector('.learn-xq-ribbon')?.textContent).toBe('3 / 6');
    expect(card?.querySelector<HTMLElement>('.learn-xq-tile-line-fill')?.style.width).toBe('50%');
  });

  it('says Done on a finished set, with no ring', async () => {
    const root = await mount(practiceResponse({ solvedCount: 6 }));
    const card = root.querySelector<HTMLElement>('.learn-xq-tile');
    expect(card?.classList.contains('learn-xq-tile--done')).toBe(true);
    expect(card?.querySelector('.learn-xq-ribbon')?.textContent).toBe('Done');
    expect(card?.querySelector('.learn-xq-tile-ring')).toBeNull();
  });
});

describe('practiceTileState', () => {
  it('reads done, in progress, next and untouched from the counts', () => {
    expect(practiceTileState({ solvedCount: 6, exerciseCount: 6 }, false)).toEqual({
      state: 'done',
      ribbon: 'done',
    });
    expect(practiceTileState({ solvedCount: 2, exerciseCount: 6 }, false)).toEqual({
      state: 'ongoing',
      ribbon: 'progress',
    });
    // In progress outranks "next": a started set shows its count, not Play!.
    expect(practiceTileState({ solvedCount: 2, exerciseCount: 6 }, true)).toEqual({
      state: 'ongoing',
      ribbon: 'progress',
    });
    expect(practiceTileState({ solvedCount: 0, exerciseCount: 6 }, true)).toEqual({
      state: 'ongoing',
      ribbon: 'play',
    });
    expect(practiceTileState({ solvedCount: 0, exerciseCount: 6 }, false)).toEqual({
      state: 'future',
      ribbon: 'count',
    });
    // An empty set is never "done".
    expect(practiceTileState({ solvedCount: 0, exerciseCount: 0 }, false).state).toBe('future');
  });

  it('picks the first unfinished card in teaching order as next', () => {
    const card = (slug: string, solvedCount: number) => ({
      slug,
      title: slug,
      blurb: slug,
      studyId: slug,
      exerciseCount: 4,
      solvedCount,
    });
    const sections: PracticeSectionDto[] = [
      { id: 'a', title: 'A', cards: [card('one', 4), card('two', 1)] },
      { id: 'b', title: 'B', cards: [card('three', 0)] },
    ];
    expect(nextPracticeSlug(sections)).toBe('two');
    expect(nextPracticeSlug([{ id: 'a', title: 'A', cards: [card('one', 4)] }])).toBeNull();
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
