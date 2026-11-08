// Shared player-study SerializedTree builder; engine tokens use ICCS ranks.
/** Study trees use ranks 1-10; the analyser emits ICCS 0-9. */
export const toStudyUci = (iccs) =>
  `${iccs[0]}${Number(iccs[1]) + 1}${iccs[2]}${Number(iccs[3]) + 1}`;
const NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
/** Assessment symbols -> PGN NAGs, same table as world-title-study.mjs. */
const ASSESS_NAG = { '=': 10, '∞': 13, '⩲': 14, '⩱': 15, '±': 16, '∓': 17, '+−': 18, '−+': 19 };

/** Mainline as first children; each engine line a sibling on the node the
 *  refuted move was played from. The shape study-chapter-to-article reads back. */
export function buildTree(iccs, byPly = {}, comment = (text) => ({ text })) {
  const mainline = iccs.trim().split(/\s+/);
  const root = { annotations: {}, children: [] };
  const nodes = [root];
  for (const [index, token] of mainline.entries()) {
    const node = { uci: toStudyUci(token), children: [] };
    const annotation = byPly[String(index + 1)];
    if (annotation) {
      const glyph = NAG[annotation.glyph];
      node.annotations = {
        ...(glyph ? { glyphs: [glyph] } : {}),
        ...(annotation.note ? { comments: [comment(annotation.note)] } : {}),
      };
    }
    nodes[index].children.push(node);
    nodes.push(node);
  }
  for (const [plyKey, annotation] of Object.entries(byPly)) {
    if (!annotation.line) continue;
    const parent = nodes[Number(plyKey) - 1];
    if (!parent) continue;
    let cursor = parent;
    for (const token of annotation.line.trim().split(/\s+/)) {
      const node = { uci: toStudyUci(token), children: [] };
      cursor.children.push(node);
      cursor = node;
    }
    // The verdict closes the line: last node, where the tree's assessment slot is.
    const assess = ASSESS_NAG[annotation.lineEval];
    if (assess !== undefined && cursor !== parent) {
      cursor.annotations = { ...cursor.annotations, glyphs: [assess] };
    }
  }
  return { version: 1, root };
}
