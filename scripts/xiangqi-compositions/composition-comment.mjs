/**
 * The root comment on a classical-manual chapter.
 *
 * Shared because two callers write it and they must not drift: `seed-v2.mjs`
 * creates chapters, `patch-vol6-prose.mjs` rewrites existing ones. When those
 * disagree, half a study says one thing about its source and half says another,
 * and nothing detects it -- `validate-studies.mjs` only checks that the comment
 * names the right composition, not that two builders agree on the wording.
 */

/**
 * The source's comment tags in tag order. `comments` is keyed by the ply the
 * note hangs off, sparse and stringly-keyed, so "0" must sort before "10".
 */
export function proseFrom(rec) {
  return Object.entries(rec?.comments ?? {})
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, text]) => text);
}

/**
 * @param {object} p
 * @param {string} p.zh          four-character Chinese title, without 第N局
 * @param {string|undefined} p.en English rendering, if we have one
 * @param {number} p.n           composition number within the manual
 * @param {number} p.vol         volume number
 * @param {string} p.volZh       volume label, e.g. 卷六
 * @param {string} p.bookZh      manual name, e.g. 適情雅趣
 * @param {number} p.moveCount   plies in the mainline we stored
 * @param {string[]} p.prose     the source's own comment tags, in tag order
 * @param {string} p.url         the dpxq page this came from
 */
export function compositionComment(p) {
  let line;
  if (p.moveCount > 1) {
    // Deliberately nothing. The first version said "the solution runs 11 moves
    // and is played out as the mainline below" to a reader looking at eleven
    // moves, and added an apology for variations we had not imported, on four
    // hundred chapters. A comment that restates the board is worse than no
    // comment: it teaches the reader to skip the place where real notes go.
    // The variations caveat now lives in the study description, said once.
    line = '';
  } else if (p.prose?.length) {
    // dpxq keeps a draw study's answer as prose because the answer is a
    // principle, not a forced line. Saying "the source records only the opening
    // move" -- which is what shipped on 53 chapters in September 2026 -- is
    // false about the record: the answer is right there, in the comment tags.
    line =
      ` The source gives its answer in prose rather than as a line, which is what a draw ` +
      `study usually needs: ${p.prose.map((t) => `「${t}」`).join(' ')}`;
  } else {
    line = ` The source records only the opening move of the solution, played below.`;
  }

  return (
    `${p.zh}${p.en ? ` — "${p.en}"` : ''}\n\n` +
    `Problem ${p.n} of ${p.bookZh}, volume ${p.vol} (${p.volZh}).${line}` +
    (p.url ? `\n\nTranscribed from ${p.url}` : '')
  );
}
