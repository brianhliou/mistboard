// Variant identity metadata: the id every variant surface keys its marker on
// (variant-markers.ts), with the label, accent and blurb that go with it.
//
// This module used to draw a cropped "mini board" per variant, and
// renderVariantMarker fell back to that board for any variant without final
// marker art. The fallback is gone (2026-10-01): a variant without a marker is
// a type error in variant-markers.ts and a failing test, never a stand-in
// picture. The ids stay here because a dozen modules import the type from
// this path.

export type VariantMiniId =
  | 'dark-chess'
  | 'xiangqi'
  | 'dark-xiangqi'
  | 'fortress-xiangqi'
  | 'duck-xiangqi'
  | 'atomic-xiangqi'
  | 'crazyhouse-xiangqi'
  | 'jieqi'
  | 'banqi'
  | 'jungle'
  | 'jungle-flip';

export type VariantMiniFamily = 'chess' | 'xiangqi' | 'jungle';

export interface VariantMiniDef {
  id: VariantMiniId;
  label: string;
  shortLabel: string;
  accent: string;
  blurb: string;
  // Which board family the tile belongs to, retained as marker metadata.
  family: VariantMiniFamily;
}

export const VARIANT_MINIS: readonly VariantMiniDef[] = [
  {
    id: 'dark-chess',
    label: 'Fog Chess',
    shortLabel: 'DC',
    accent: '#1f6f5b',
    blurb: 'Four pawns over a back rank; the enemy half all fog.',
    family: 'chess',
  },
  {
    id: 'xiangqi',
    label: 'Xiangqi',
    shortLabel: 'XQ',
    accent: '#8b5a24',
    blurb: "Red's court and cannon across the river board, nothing hidden.",
    family: 'xiangqi',
  },
  {
    id: 'dark-xiangqi',
    label: 'Fog Xiangqi',
    shortLabel: 'DX',
    accent: '#9f342d',
    blurb: "Red's court and cannon; fog marks the squares no red piece can reach.",
    family: 'xiangqi',
  },
  {
    id: 'fortress-xiangqi',
    label: 'Fortress Xiangqi',
    shortLabel: 'STF',
    accent: '#b45309',
    blurb: 'Xiangqi with a pocket: opposite-corner palaces, crazyhouse drops, and the Treasure.',
    family: 'xiangqi',
  },
  {
    id: 'duck-xiangqi',
    label: 'Duck Xiangqi',
    shortLabel: 'DKX',
    accent: '#b8860b',
    blurb:
      'Xiangqi with a shared duck that both players move, blocking and screening for either side.',
    family: 'xiangqi',
  },
  {
    id: 'atomic-xiangqi',
    label: 'Atomic Xiangqi',
    shortLabel: 'ATX',
    accent: '#d99a1e',
    blurb: 'Xiangqi where every capture explodes onto the four points beside it.',
    family: 'xiangqi',
  },
  {
    id: 'crazyhouse-xiangqi',
    label: 'Crazyhouse Xiangqi',
    shortLabel: 'CHX',
    accent: '#a33b6b',
    blurb: 'Xiangqi where a captured piece joins your hand, to be dropped back as your own.',
    family: 'xiangqi',
  },
  {
    id: 'jieqi',
    label: 'Jieqi',
    shortLabel: 'JQ',
    accent: '#6d4aa0',
    blurb: 'The xiangqi opening with every piece flipped face-down but the general.',
    family: 'xiangqi',
  },
  {
    id: 'banqi',
    label: 'Banqi',
    shortLabel: 'BQ',
    accent: '#2563a6',
    blurb: 'All 32 pieces face-down on a half board; flip one or move a revealed piece.',
    family: 'xiangqi',
  },
  {
    id: 'jungle',
    label: 'Jungle Chess',
    shortLabel: 'JG',
    accent: '#2e7d4a',
    blurb: 'Animal ranks across the river board: the rat swims and beats the elephant.',
    family: 'jungle',
  },
  {
    id: 'jungle-flip',
    label: 'Flip Jungle',
    shortLabel: 'FJ',
    accent: '#1f7a5e',
    blurb: 'Animals shuffled face-down on a 4x4 grid; flip to reveal, equal ranks trade.',
    family: 'jungle',
  },
];

export function variantMiniForId(id: VariantMiniId): VariantMiniDef {
  const def = VARIANT_MINIS.find((candidate) => candidate.id === id);
  if (!def) throw new Error(`Unknown variant mini: ${id}`);
  return def;
}
