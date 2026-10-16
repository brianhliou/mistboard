import { findJieqiGeneral, getJieqiLegalMoves, parseJieqiFen } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import {
  JIEQI_BOT_WINS_STALEMATE_FEN,
  jieqiBotWinsArticle,
} from './articles/content/jieqi-bot-wins.js';

// The card claims a stalemate: Red to move, general on d1, no legal move. The
// kernel has to agree, or the picture on the article is a second, wrong copy
// of the rule the article explains.
describe('jieqi-bot-wins card', () => {
  it('shows a position where Red has no legal move', () => {
    const parsed = parseJieqiFen(JIEQI_BOT_WINS_STALEMATE_FEN);
    if (!parsed.ok) throw new Error(parsed.error);
    expect(parsed.state.status).toEqual({ type: 'playing', turn: 'red' });
    expect(findJieqiGeneral(parsed.state.board, 'red')).toBe('d1');
    expect(getJieqiLegalMoves(parsed.state)).toEqual([]);
  });

  it('renders the crop with the general and both crossed points', () => {
    const thumb = jieqiBotWinsArticle.thumbnail;
    if (thumb?.kind !== 'svg') throw new Error('expected an svg thumbnail');
    const svg = typeof thumb.svg === 'function' ? thumb.svg('en') : thumb.svg;
    expect(svg).toContain('aria-label="Red\'s general stalemated on d1"');
    expect(svg.match(/stroke="#d4351c"/g)).toHaveLength(4);
  });
});

// Every game is shown from the winner's side: the two Black wins are turned so
// the player sits at the bottom, the two Red wins keep the default view.
describe('jieqi-bot-wins game embeds', () => {
  it('turns each board to the side that won', () => {
    const paths = (jieqiBotWinsArticle.sections ?? [])
      .flatMap((section) => section.blocks)
      .flatMap((block) => (block?.kind === 'embed' ? [block.path] : []));
    expect(
      paths.map((path) => [
        path.split('/')[3]?.slice(0, 11),
        new URL(path, 'https://x').searchParams.get('pov'),
      ]),
    ).toEqual([
      ['jq_53ead5f3', 'black'],
      ['jq_207d4371', 'white'],
      ['jq_4b7e09b1', 'white'],
      ['jq_2538c964', 'black'],
    ]);
  });
});
