// English names for ECCO opening strings ("C70 五七炮对屏风马进３卒"), built
// compositionally from a glossary of xiangqi opening terms. A name translates
// only when EVERY token of it is in the glossary; anything else returns
// en: null and the page shows the Chinese. A half-translated name is never
// emitted.
//
// Terminology follows Jim Png's xqinenglish.com glossaries (also republished
// on xiangqi.com) where they exist, since that is the English literature's
// main source. Where sources disagree, the choice and the alternative are
// noted beside the entry. Terms marked GUESS had no English source found and
// are literal renderings.
//
// Grammar. The main name (before the first space) is split into segments on
// 对 (vs), 转 (into, a transposition) and 或 (or). A segment's first term is
// its head; the rest follow after "with", comma-joined:
//   五七炮互进三兵对屏风马进３卒
//   -> Five-Seven Cannons with Both 3rd Pawns Advanced vs Screen Horses with
//      3rd Pawn Advanced
// A trailing 局 adds "Opening" to the head unless it already says it. The
// sub-variation after the space (红左横车对黑兑边卒) renders as side-labelled
// segments after a colon, ECO style ("Sicilian Defence: Najdorf"), and is
// dropped, keeping the main name, when any of its tokens is unknown.

type Term = {
  /** The term as a segment's head. */
  en: string;
  /** The term after the head, when it reads differently there (飞相 as a
   *  head is the Elephant Opening; after one it is just the elephant move). */
  mod?: string;
};

// Separators and markers, matched by the same longest-first scan.
const VS = '对';
const INTO = '转';
const OR = '或';
const OPENING = '局';
const RED = '红';
const BLACK = '黑';
const SEPARATORS: Record<string, string> = { [VS]: 'vs', [INTO]: 'into', [OR]: 'or' };

// Keys are written after normalize(): fullwidth digits become ASCII and 士
// becomes 仕 (the same piece; ECCO strings use both).
const GLOSSARY: Record<string, Term> = {
  // --- Red's first-move systems ---
  中炮: { en: 'Central Cannon' },
  左中炮: { en: 'Left Central Cannon' },
  右中炮: { en: 'Right Central Cannon' },
  五六炮: { en: 'Five-Six Cannons' }, // xqinenglish/xiangqi.com write "56 Cannons"
  五七炮: { en: 'Five-Seven Cannons' }, // "57 Cannons" there
  五八炮: { en: 'Five-Eight Cannons' }, // "58 Cannons" there
  仙人指路: { en: 'Pawn Opening' },
  飞相: { en: 'Elephant Opening', mod: 'Elephant' },
  顺相: { en: 'Same Direction Elephants' }, // GUESS, by analogy with 顺炮
  起马: { en: 'Horse Opening' },
  // 仕角炮: xqinenglish and xiangqi.com both use "Palcorner Cannon"; "Palace
  // Corner Cannon" and "Advisor Corner Cannon" appear elsewhere, less often.
  仕角炮: { en: 'Palcorner Cannon' },
  左仕角炮: { en: 'Left Palcorner Cannon' },
  右仕角炮: { en: 'Right Palcorner Cannon' },
  // 过宫炮: "Cross-Palace Cannon" on xqinenglish, xiangqi.com and xiangqi.one.
  过宫炮: { en: 'Cross-Palace Cannon' },
  // 对兵局: xqinenglish's "Pawn vs Pawn opening".
  对兵: { en: 'Pawn vs Pawn' },

  // --- Black's defences ---
  // 屏风马: "Screen Horse Defense" on xqinenglish; the repo's explorer already
  // says "Screen Horses", kept for one name across the site.
  屏风马: { en: 'Screen Horses' },
  // 反宫马: xqinenglish/xiangqi.com "Sandwiched Horse Defense"; "Reverse
  // Palace Horse" is the literal form some sites use.
  反宫马: { en: 'Sandwiched Horses' },
  顺炮: { en: 'Same Direction Cannons' },
  列炮: { en: 'Opposite Direction Cannons' },
  后补列炮: { en: 'Delayed Opposite Direction Cannons' }, // GUESS
  左三步虎: { en: 'Left Three-Step Tiger' }, // xiangqi.com "Left 3 Step Tiger"
  左炮封车: { en: 'Left Cannon Blockade' }, // xiangqi.com
  // 卒底炮/兵底炮: "Pawn-Base Cannon" is the form English sources use.
  卒底炮: { en: 'Pawn-Base Cannon' },
  兵底炮: { en: 'Pawn-Base Cannon' },
  飞象: { en: 'Elephant' },
  飞左象: { en: 'Left Elephant' },
  飞右象: { en: 'Right Elephant' },

  // --- Chariots (xqinenglish: 横车 Ranked, 直车 Filed, 巡河车 Riverbank) ---
  横车: { en: 'Ranked Chariot' },
  左横车: { en: 'Left Ranked Chariot' },
  右横车: { en: 'Right Ranked Chariot' },
  双横车: { en: 'Double Ranked Chariots' },
  直车: { en: 'Filed Chariot' },
  左直车: { en: 'Left Filed Chariot' },
  右直车: { en: 'Right Filed Chariot' },
  双直车: { en: 'Double Filed Chariots' },
  巡河车: { en: 'Riverbank Chariot' },
  // 过河车: xiangqi.com's glossary has "Pawn Ranked Chariot"; xqinenglish's
  // own articles say "Cross-River Chariot", the common form.
  过河车: { en: 'Cross-River Chariot' },
  平炮兑车: { en: 'Cannon Shift to Trade Chariots' },

  // --- Horses (xqinenglish: 正马 Proper, 边马 Edge, 盘河马 Riverbank) ---
  七路马: { en: 'Seventh-File Horse' },
  左边马: { en: 'Left Edge Horse' },
  右边马: { en: 'Right Edge Horse' },
  互进边马: { en: 'Both Edge Horses' },
  左正马: { en: 'Left Proper Horse' },
  左马盘河: { en: 'Left Riverbank Horse' },
  右马外盘河: { en: 'Right Outer Riverbank Horse' },
  进左马: { en: 'Left Horse' },
  进右马: { en: 'Right Horse' },
  不进左马: { en: 'Left Horse Held Back' },
  互进右马: { en: 'Both Right Horses' },

  // --- Cannons ---
  巡河炮: { en: 'Riverbank Cannon' }, // xiangqi.com
  过河炮: { en: 'Cross-River Cannon' },
  边炮: { en: 'Edge Cannon' },
  左边炮: { en: 'Left Edge Cannon' },
  退边炮: { en: 'Edge Cannon Retreat' },
  双炮过河: { en: 'Double Cross-River Cannons' },
  平炮压马: { en: 'Cannon Shift Pressing the Horse' },

  // --- Pawns ---
  两头蛇: { en: 'Double-Headed Snake' }, // xqinenglish; "Two-Headed Snake" is the literal
  进三兵: { en: '3rd Pawn Advanced' },
  进七兵: { en: '7th Pawn Advanced' },
  进3卒: { en: '3rd Pawn Advanced' },
  进7卒: { en: '7th Pawn Advanced' },
  互进三兵: { en: 'Both 3rd Pawns Advanced' },
  互进七兵: { en: 'Both 7th Pawns Advanced' },
  连进7卒: { en: '7th Pawn Advanced Twice' },
  进中兵: { en: 'Central Pawn Advanced' },
  边卒: { en: 'Edge Pawn' },
  兑边卒: { en: 'Edge Pawn Exchange' },
  兑7卒: { en: '7th Pawn Exchange' },

  // --- Advisors ---
  上仕: { en: 'Advisor Up' },
  上右仕: { en: 'Right Advisor Up' },
  先上仕: { en: 'Advisor Up First' },
};

const KEYS = [...Object.keys(GLOSSARY), VS, INTO, OR, OPENING, RED, BLACK].sort(
  (a, b) => b.length - a.length,
);

/** Terms that only name an opening at the very start of a name: 对兵 would
 *  otherwise swallow a 对 separator followed by a pawn move. */
const START_ONLY = new Set(['对兵']);

function normalize(text: string): string {
  return text
    .replace(/[０-９]/g, (d) => String.fromCharCode(d.charCodeAt(0) - 0xfee0))
    .replace(/士/g, '仕');
}

/** Longest-first scan into glossary keys; null when any stretch is unknown. */
function tokenize(text: string): string[] | null {
  const tokens: string[] = [];
  let i = 0;
  while (i < text.length) {
    const key = KEYS.find((k) => text.startsWith(k, i) && (i === 0 || !START_ONLY.has(k)));
    if (!key) return null;
    tokens.push(key);
    i += key.length;
  }
  return tokens;
}

/** Split tokens on separators into [separator-before, terms] segments. */
function segments(tokens: readonly string[]): { sep: string | null; terms: string[] }[] {
  const out: { sep: string | null; terms: string[] }[] = [{ sep: null, terms: [] }];
  for (const token of tokens) {
    if (token in SEPARATORS) out.push({ sep: token, terms: [] });
    else out[out.length - 1]!.terms.push(token);
  }
  return out;
}

function mainEnglish(text: string): string | null {
  const tokens = tokenize(normalize(text));
  if (!tokens || tokens.length === 0) return null;
  const parts: string[] = [];
  for (const { sep, terms } of segments(tokens)) {
    const opening = terms[terms.length - 1] === OPENING;
    const body = opening ? terms.slice(0, -1) : terms;
    if (body.length === 0 || body.some((t) => !(t in GLOSSARY))) return null;
    let head = GLOSSARY[body[0]!]!.en;
    if (opening && !head.endsWith('Opening')) head += ' Opening';
    const rest = body.slice(1).map((t) => GLOSSARY[t]!.mod ?? GLOSSARY[t]!.en);
    if (sep) parts.push(SEPARATORS[sep]!);
    parts.push(rest.length > 0 ? `${head} with ${rest.join(', ')}` : head);
  }
  return parts.join(' ');
}

function subEnglish(text: string): string | null {
  const tokens = tokenize(normalize(text));
  if (!tokens || tokens.length === 0) return null;
  const parts: string[] = [];
  for (const { sep, terms } of segments(tokens)) {
    if (sep && sep !== VS) return null;
    const side = terms[0] === RED ? 'Red' : terms[0] === BLACK ? 'Black' : null;
    const body = side ? terms.slice(1) : terms;
    if (body.length === 0 || body.some((t) => !(t in GLOSSARY))) return null;
    const words = body.map((t) => GLOSSARY[t]!.mod ?? GLOSSARY[t]!.en).join(', ');
    if (sep) parts.push('vs');
    parts.push(side ? `${side} ${words}` : words);
  }
  return parts.join(' ');
}

export type EccoEnglish = { code: string | null; en: string | null; zh: string };

/**
 * "C70 五七炮对屏风马进３卒" -> { code: 'C70', en: 'Five-Seven Cannons vs
 * Screen Horses with 3rd Pawn Advanced', zh: '五七炮对屏风马进３卒' }.
 * en is null when any term of the main name is outside the glossary; the
 * sub-variation is appended only when every one of its terms is known.
 */
export function eccoEnglish(opening: string): EccoEnglish {
  const text = opening.trim();
  const match = text.match(/^([A-E]\d{2})(?:\s+(.*))?$/);
  const code = match ? match[1]! : null;
  const zh = match ? (match[2]?.trim() ?? '') : text;
  if (!zh) return { code, en: null, zh };
  const space = zh.search(/\s/);
  const main = space === -1 ? zh : zh.slice(0, space);
  const sub = space === -1 ? '' : zh.slice(space).trim();
  const mainEn = mainEnglish(main);
  if (!mainEn) return { code, en: null, zh };
  const subEn = sub ? subEnglish(sub) : null;
  return { code, en: subEn ? `${mainEn}: ${subEn}` : mainEn, zh };
}
