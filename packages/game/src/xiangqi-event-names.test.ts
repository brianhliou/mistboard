import assert from 'node:assert/strict';
import test from 'node:test';
import { translateXiangqiEventNameStrict } from './xiangqi-event-names.js';

test('DPXQ pairs events translate consistently on study and broadcast pages', () => {
  assert.equal(
    translateXiangqiEventNameStrict('2025年第八届“一带一路”锦江杯成都全球象棋双人赛 双人赛'),
    '2025 8th Belt and Road Jinjiang Cup Chengdu Global Xiangqi Pairs',
  );
  assert.equal(translateXiangqiEventNameStrict('象棋双人赛　双人赛 双人赛'), 'Xiangqi Pairs');
  assert.equal(
    translateXiangqiEventNameStrict('象棋双人赛 预赛A组'),
    'Xiangqi Pairs Preliminary Group A',
  );
  assert.equal(
    translateXiangqiEventNameStrict('全国棋类比赛 个人乙组'),
    'National Board Games Competition Individual Division B',
  );
  assert.equal(translateXiangqiEventNameStrict('未知杯'), undefined);
});
