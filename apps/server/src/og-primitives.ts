// The constants every OG card module shares. Split out of og-image.ts so the
// board renderer (og-card-board.ts) can import them without og-image importing
// it back (og-image draws the study and rules cards through it).

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;

export const OG_FONT = "'Noto Sans', system-ui, -apple-system, Helvetica, Arial, sans-serif";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
