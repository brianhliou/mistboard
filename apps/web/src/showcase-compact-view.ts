// Shared selection of the SINGLE board a variant shows in the homepage showcase
// (compact) viewer, honoring hidden information. The showcase only ever replays
// FINISHED games (whose truth is already public via the per-game reveal gate),
// so the rule below is a PRODUCT choice — show the fog/identity off — not a
// redaction boundary:
//
//  - reveal tenants (hidden identities, e.g. jieqi): the AS-PLAYED masked board
//    (reveal.hiddenKey), never the revealed-truth board;
//  - per-color hidden info (fog, e.g. dark-xiangqi / dark-mini-xiangqi):
//    one side's own POV, chosen at random but STABLE per room and
//    oriented to that side;
//  - perfect-info / symmetric (banqi, jungle, mini-open xiangqi): the truth board.
//
// Used by every showcase-capable renderer (the two generic tenant frameworks and
// the self-contained Dark Mini Xiangqi one). Chess picks its POV in the outer
// controller via panes.resolver, but reuses hashRoomId here for the same
// stable-per-room side.

export type CompactPaneKind = 'white' | 'truth' | 'black';

// FNV-1a over the room id: keeps a fog variant's "random side" fixed across
// re-renders/reloads of the same game instead of flickering each paint.
export function hashRoomId(roomId: string): number {
  let h = 2166136261;
  for (let i = 0; i < roomId.length; i += 1) {
    h ^= roomId.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type CompactViewChoice<K extends string> = {
  key: K;
  /**
   * Which side's POV was chosen: 'first' = the white/red-side board, 'second' =
   * the black-side board, 'none' = a truth or masked board with no per-color
   * orientation. Callers map this to their own color type.
   */
  side: 'first' | 'second' | 'none';
};

export function pickCompactViewKey<K extends string>(args: {
  roomId: string;
  entries: ReadonlyArray<{ key: K }>;
  paneKind: (key: K) => CompactPaneKind;
  reveal?: { hiddenKey: K };
}): CompactViewChoice<K> {
  // Hidden-identity tenants render the as-played masked board, never truth.
  if (args.reveal) return { key: args.reveal.hiddenKey, side: 'none' };
  const colorEntries = args.entries.filter((entry) => args.paneKind(entry.key) !== 'truth');
  if (colorEntries.length > 0) {
    const pick = colorEntries[hashRoomId(args.roomId) % colorEntries.length]!;
    return { key: pick.key, side: args.paneKind(pick.key) === 'black' ? 'second' : 'first' };
  }
  const truth =
    args.entries.find((entry) => args.paneKind(entry.key) === 'truth') ?? args.entries[0];
  // Empty entries would be a caller bug (every postgame yields >= 1 view); fall
  // back to the first entry's key rather than throwing on an undefined pick.
  return { key: (truth ?? args.entries[0])!.key, side: 'none' };
}
