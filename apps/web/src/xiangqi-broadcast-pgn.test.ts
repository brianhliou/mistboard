import type { XiangqiMove } from '@mistboard/game';
import { describe, expect, it } from 'vitest';
import { broadcastGamePgn, broadcastPgnFileName, pgnDataHref } from './xiangqi-broadcast-pgn.js';

const GAME = {
  boardId: 'b-1',
  red: { name: '王天一', nameEn: 'Wang Tianyi', federation: '杭州', federationEn: 'Hangzhou' },
  black: { name: '郑惟桐', nameEn: 'Zheng Weitong' },
  result: '1-0' as const,
  // 炮二平五 马8进7: central cannon, then the horse.
  moves: [
    { from: 'h3', to: 'e3' },
    { from: 'h10', to: 'g8' },
  ] as XiangqiMove[],
  tour: {
    name: '2026年全国象棋男子甲级联赛',
    nameEn: '2026 National Xiangqi Men Division A League',
  },
  round: { name: '第01轮', nameEn: 'Round 1', startsAt: '2026-09-14T09:00:00+08:00' },
  origin: 'https://mistboard.com',
};

describe('broadcast game PGN', () => {
  it('names both sides in English, keeps the Chinese, and dates the event day', () => {
    const pgn = broadcastGamePgn(GAME);
    expect(pgn).toContain('[Event "2026 National Xiangqi Men Division A League"]');
    expect(pgn).toContain('[Round "Round 1"]');
    expect(pgn).toContain('[Date "2026.09.14"]');
    expect(pgn).toContain('[Red "Wang Tianyi"]');
    expect(pgn).toContain('[Black "Zheng Weitong"]');
    expect(pgn).toContain('[RedTeam "Hangzhou"]');
    expect(pgn).toContain('[RedZh "王天一"]');
    expect(pgn).toContain('[Result "1-0"]');
    expect(pgn).toContain('[Source "https://mistboard.com/broadcast/xiangqi/board/b-1"]');
    expect(pgn.trim().endsWith('1-0')).toBe(true);
  });

  it('writes WXF when the line replays and coordinates when it does not', () => {
    expect(broadcastGamePgn(GAME)).toMatch(/1\. C2\.5 H8\+7 1-0/);
    // A black move first cannot replay from the opening position.
    const broken = broadcastGamePgn({
      ...GAME,
      moves: [{ from: 'h10', to: 'g8' }] as XiangqiMove[],
    });
    expect(broken).not.toMatch(/H8\+7/);
  });

  it('gives a safe file name and a data link', () => {
    expect(broadcastPgnFileName(GAME)).toBe('Wang Tianyi vs Zheng Weitong.pgn');
    expect(pgnDataHref('[Red "A/B"]')).toBe(
      'data:application/x-chess-pgn;charset=utf-8,%5BRed%20%22A%2FB%22%5D',
    );
  });
});
