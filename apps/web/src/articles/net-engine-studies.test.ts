import { getThreeKingdomsBanqiPlayerView } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import banqi from '../../../../scripts/data/banqi-net-study.json';
import tk from '../../../../scripts/data/three-kingdoms-net-study.json';
import { netChapter, replayNetGame, type NetStudyData } from '../../../../scripts/net-engine-study.js';
import { banqiArticle } from './content/banqi.js';
import { threeKingdomsBanqiArticle } from './content/three-kingdoms-banqi.js';
import { mountChapterEmbed } from '../embed/embed-study-page.js';
import { replayThreeKingdomsBanqiLine } from '../three-kingdoms-banqi-replay-board.js';
import { TK_LIVE_BOARD_VIEW } from '../three-kingdoms-banqi-diagrams.js';

for (const [article, raw, wins, draws, losses] of [[banqiArticle, banqi, 18, 1, 1], [threeKingdomsBanqiArticle, tk, 16, 0, 4]] as const) {
  const data = raw as NetStudyData;
  describe(`${data.variant} net study`, () => {
    it('replays all twenty exact deals under current rules and matches the run totals', () => {
      expect(data.games).toHaveLength(20);
      const totals = [0, 0, 0];
      let sawDraw = false;
      for (const game of data.games) {
        const states = replayNetGame(data.variant, game);
        const final = states.at(-1)!;
        expect(final.captures).toHaveLength(game.captures);
        expect(states.at(-2)!.status.type).toBe('playing');
        expect(game.moves.filter((m) => m.slice(0, 2) === m.slice(2))).toHaveLength(game.flips);
        expect(game.netSeat === 0 ? game.red : game.black).toBe('MistyBanqi (net)');
        expect(game.netSeat === 0 ? game.black : game.red).toBe('MistyBanqi (classical)');
        const draw = game.result === '1/2-1/2';
        if (draw) sawDraw = true;
        else expect(sawDraw).toBe(false);
        totals[draw ? 1 : game.result === (game.netSeat === 0 ? '1-0' : '0-1') ? 0 : 2]++;
        expect(game.rootFen.split(' ')).toHaveLength(6);
        for (const ply of Object.keys(game.notes)) expect(Number(ply)).toBeLessThan(states.length);
      }
      expect(totals).toEqual([wins, draws, losses]);
    });
    it('keeps the article embed, companion link and selected chapter in sync, including pending ids', () => {
      const selected = data.games.find((g) => g.gameId === data.selectedGameId)!;
      const pending = data.variant === 'banqi' ? 'BANQI_NET' : 'THREE_KINGDOMS_NET';
      const id = data.studyId ?? `${pending}_STUDY_PENDING`;
      const chapter = selected.chapterId ?? `${pending}_CHAPTER_PENDING`;
      const blocks = article.sections.find((s) => s.heading === 'An engine game')!.blocks!;
      const embed = blocks.find((b) => b.kind === 'embed')!;
      expect(embed.kind === 'embed' && embed.path).toBe(`/embed/study/${id}/${chapter}?ply=${data.embedPly}`);
      expect(blocks.some((b) => b.kind === 'paragraph' && b.text.includes(`/study/${id}`))).toBe(true);
      expect(selected.result).toBe(selected.netSeat === 0 ? '1-0' : '0-1');
    });
  });
}

it('banqi chapter 9: the net cannon jumps h3 and takes the general on h2 at ply 22', () => {
  const data = banqi as NetStudyData;
  const game = data.games.find((g) => g.gameId === data.selectedGameId)!;
  expect(data.games.indexOf(game)).toBe(8);
  const states = replayNetGame('banqi', game);
  expect(game.plies).toBe(218);
  expect(game.moves[21]).toBe('h4h2');
  expect(states[21]!.board.h3).toBeDefined();
  expect(states[21]!.board.h4).toMatchObject({ color: 'red', role: 'cannon' });
  expect(states[22]!.captures.at(-1)).toMatchObject({ owner: 'black', role: 'general' });
});

it('Three Kingdoms chapter 12: the horse recapture reaches 95, then the soldier reaches 100', () => {
  const data = tk as NetStudyData;
  const game = data.games.find((g) => g.gameId === data.selectedGameId)!;
  expect(data.games.indexOf(game)).toBe(11);
  const states = replayNetGame(data.variant, game);
  expect(game.plies).toBe(107);
  expect(states[105]).toMatchObject({ scores: { red: 95, black: 90 } });
  expect(states[104]!.board.e4).toMatchObject({ color: 'red', role: 'horse' });
  expect(states[105]!.captures.at(-1)).toMatchObject({ owner: 'black', role: 'general' });
  expect(states[107]).toMatchObject({ scores: { red: 100, black: 90 }, status: { winner: 'red', reason: 'score' } });
});

it('renders the Three Kingdoms embed from its exact deal, masking hidden roles and stepping the capture', async () => {
  const data = tk as NetStudyData;
  const game = data.games.find((g) => g.gameId === data.selectedGameId)!;
  const line = replayThreeKingdomsBanqiLine(game.rootFen, game.moves)!;
  expect(line.played).toHaveLength(107);
  expect(replayThreeKingdomsBanqiLine(game.rootFen, ['a1i5'])).toBeNull();
  const root = document.createElement('div');
  await mountChapterEmbed(root, { href: '/study/local', text: 'Study' }, { ...netChapter(data.variant, game), id: 'local' }, { startPly: 103 });
  const svg = root.querySelector('.tk-banqi-live-board > svg');
  expect(root.textContent).not.toContain('cannot be framed');
  expect(root.querySelectorAll('[data-square]')).toHaveLength(45);
  expect(root.querySelector('svg[viewBox]')?.getAttribute('viewBox')).toContain(`${TK_LIVE_BOARD_VIEW.width} ${TK_LIVE_BOARD_VIEW.height}`);
  expect(svg).not.toBeNull();
  const view = getThreeKingdomsBanqiPlayerView(line.states[0]!, 'red');
  const payload = JSON.parse(JSON.stringify(view));
  expect(Object.values(payload.board)).toHaveLength(32);
  for (const entry of Object.values(payload.board)) expect(entry).toEqual({ faceDown: true });
});
