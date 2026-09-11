// Card art for "Puzzles with more than one solution". The article itself is boards and
// tables: two diagrams (the old gate as a race, the grader's search cap as a
// tree) were drawn and cut on 2026-09-11, because both illustrated a sentence
// the prose already carried and read as filler beside a real position.
//
// The card box is 16:10 and the SVG slices to fill it, the same canvas as the
// mining explainer's thumbnail, so the two puzzle articles sit as a pair on the
// index. The glyph is two answers on one line: the filled circle is the stored
// solution, the hollow one the second mate the grader used to refuse.

const ACCENT = 'var(--site-accent, #2f7d62)';
const DANGER = 'var(--site-danger, #b4532a)';
const INK = '#5a4626';

export const PTA_THUMBNAIL = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid slice" width="320" height="200" role="img" aria-label="Two circles on one line, one filled and one hollow">
<rect x="0" y="0" width="320" height="200" fill="var(--xq-diagram-bg, #d9bd82)"/>
<line x1="40" y1="100" x2="280" y2="100" stroke="${INK}" stroke-width="6" stroke-linecap="round" opacity="0.45"/>
<circle cx="112" cy="100" r="38" fill="${ACCENT}"/>
<circle cx="208" cy="100" r="38" fill="none" stroke="${DANGER}" stroke-width="11"/>
</svg>`;
