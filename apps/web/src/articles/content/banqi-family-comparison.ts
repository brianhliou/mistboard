import type { ArticleBlock } from '../types.js';

// One comparison of the banqi family, shared by each variant's rules page so
// the pages never disagree. Add a column when a variant launches (FFQ next),
// and place the table on that variant's page in the same change.
export const BANQI_FAMILY_COMPARISON: ArticleBlock = {
  kind: 'table',
  headers: ['', 'Banqi', 'Three Kingdoms banqi'],
  keyColumn: true,
  wrap: true,
  rows: [
    ['Board', '4 by 8 squares', '9 by 5 points'],
    ['Moves', 'One square; the cannon jumps to capture', 'Xiangqi moves'],
    ['Captures', 'By rank; the soldier can take the general', 'Any piece takes any piece'],
    ['Winning', 'Take or trap every enemy piece', 'First to 100 points'],
  ],
};
