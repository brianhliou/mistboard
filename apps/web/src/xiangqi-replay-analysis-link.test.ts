import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { articles } from './articles-data.js';
import {
  BROADCAST_BOARD_ID_PATTERN,
  broadcastBoardHref,
  mountXiangqiReplay,
  type XiangqiReplaySpec,
} from './xiangqi-replay.js';

// An article board carries only the moves its paragraph is about. When the game
// is in the broadcast archive, a link under the card opens the board page, which
// has the advantage chart and a verdict on every move. The link is the embed
// card's credit line (same class, same place), and it exists only when the spec
// names a board.

const BOARD_ID = '2026-xiangqi-league-2026-xiangqi-league-r07-b16mlqhe';

const plain: XiangqiReplaySpec = {
  iccs: 'h2e2 h9g7',
  red: 'Red',
  black: 'Black',
  event: 'Link',
  resultText: '*',
};
const annotated: XiangqiReplaySpec = { ...plain, annotations: { byPly: {} } };

let host: HTMLElement;
beforeEach(() => {
  document.body.replaceChildren();
  host = document.createElement('div');
  document.body.append(host);
});

const link = () => host.querySelector<HTMLAnchorElement>('a.xq-replay-analysis-link');

describe('full game analysis link', () => {
  it('points at the broadcast board when the spec names one', () => {
    mountXiangqiReplay(host, { ...annotated, boardId: BOARD_ID });
    const a = link();
    expect(a).not.toBeNull();
    expect(a?.getAttribute('href')).toBe(`/broadcast/xiangqi/board/${BOARD_ID}`);
    expect(a?.textContent).toBe('Full game analysis');
    // The embed credit's look, and its place: the last thing under the card.
    expect(a?.classList.contains('embed-credit')).toBe(true);
    expect(host.lastElementChild).toBe(a);
  });

  it('is drawn under the plain stepper too', () => {
    mountXiangqiReplay(host, { ...plain, boardId: BOARD_ID });
    expect(link()?.getAttribute('href')).toBe(broadcastBoardHref(BOARD_ID));
    expect(host.lastElementChild).toBe(link());
  });

  it('speaks the page language', () => {
    mountXiangqiReplay(host, { ...annotated, boardId: BOARD_ID }, { lang: 'zh-Hans' });
    expect(link()?.textContent).toBe('全局引擎分析');
    host.replaceChildren();
    mountXiangqiReplay(host, { ...annotated, boardId: BOARD_ID }, { lang: 'zh-Hant' });
    expect(link()?.textContent).toBe('全局引擎分析');
  });

  it('is absent without a board id', () => {
    mountXiangqiReplay(host, annotated);
    expect(link()).toBeNull();
    host.replaceChildren();
    mountXiangqiReplay(host, plain);
    expect(link()).toBeNull();
  });
});

type ReplayBlock = { kind: string; spec?: XiangqiReplaySpec };

const replaySpecs = articles.flatMap((article) =>
  [...(article.intro ?? []), ...(article.sections ?? []).flatMap((s) => s.blocks ?? [])]
    .map((block) => block as unknown as ReplayBlock)
    .filter((block) => block?.kind === 'xq-replay' && block.spec)
    .map((block) => ({ slug: article.slug, spec: block.spec as XiangqiReplaySpec })),
);

const boardsPath = [
  'scripts/data/article-broadcast-boards.json',
  '../../scripts/data/article-broadcast-boards.json',
]
  .map((candidate) => resolve(process.cwd(), candidate))
  .find((candidate) => existsSync(candidate));

describe('article board ids', () => {
  it('are well-formed broadcast board ids', () => {
    const withId = replaySpecs.filter(({ spec }) => spec.boardId !== undefined);
    // 17 on 2026-10-06; a regenerate that drops the map would silently empty it.
    expect(withId.length).toBeGreaterThanOrEqual(17);
    for (const { slug, spec } of withId) {
      expect(spec.boardId, `${slug}: ${spec.red} vs ${spec.black}`).toMatch(
        BROADCAST_BOARD_ID_PATTERN,
      );
    }
  });

  it('cover every entry in the player-page map, and the map is well-formed', () => {
    expect(boardsPath, 'scripts/data/article-broadcast-boards.json not found').toBeDefined();
    const map = JSON.parse(readFileSync(boardsPath as string, 'utf8')) as Record<string, string>;
    const onPages = new Set(replaySpecs.map(({ spec }) => spec.boardId));
    for (const [key, boardId] of Object.entries(map)) {
      expect(key).toMatch(/^m_\d+$/);
      expect(boardId, key).toMatch(BROADCAST_BOARD_ID_PATTERN);
      // An entry no page carries means the generated page was not rebuilt.
      expect(onPages.has(boardId), `${key} -> ${boardId} is on no article board`).toBe(true);
    }
  });
});
