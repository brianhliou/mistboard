import type { ArticleBlock } from '../types.js';

// One comparison of the banqi family, shared by each variant's rules page so
// the pages never disagree. Add a column when a variant launches. Columns run
// Banqi, Fanfanqi, Three Kingdoms (decided 2026-11-14, like the rules rail).
export const BANQI_FAMILY_COMPARISON: ArticleBlock = {
  kind: 'table',
  headers: ['', 'Banqi', 'Fanfanqi', 'Three Kingdoms banqi'],
  keyColumn: true,
  wrap: true,
  rows: [
    ['Board', '4 by 8 squares', '4 by 8 squares', '9 by 5 points'],
    ['Moves', 'One square; the cannon jumps to capture', 'One square; the cannon only moves to capture', 'Xiangqi moves'],
    ['Captures', 'By rank; the soldier can take the general', 'By rank; the cannon can also take face-down pieces', 'Any piece takes any piece'],
    ['Winning', 'Take or trap every enemy piece', 'Bring your opponent from 60 HP to zero', 'First to 100 points'],
  ],
};
