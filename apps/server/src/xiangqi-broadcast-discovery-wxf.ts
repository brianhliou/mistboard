// WXF category discovery: read a results category on wxf-xiangqi.org.
//
// The World Xiangqi Federation site is Joomla. Each section of an event (men,
// women, U16 boys...) gets its own category, and each round's records go up as
// one article in it, titled like "2025 世界象棋锦标赛 赛谱 男子组 第1轮", with every
// game of the round as a DhtmlXQ frame on that one page. Article ids are global
// and sequential across the whole site and are assigned in batches (2025 WXC:
// all six sections' round 1 pages first, then each section's later rounds in a
// block), so a round's id cannot be predicted ahead of time. The category
// listing is the feed: one fetch names every round's article.
//
// So this provider lists the category, reads the round each article title
// states, and hands each article URL to the stated-round manifest path, which
// pins the tour slug and files the article under `<tourSlug>-r<NN>`. The
// converter numbers the boards from the frame titles ("1-7" is round 1, table
// 7), so one article becomes a round of stable `r01t07` boards. Every article
// URL is re-checked against the source allowlist at the leaf like any other.
//
// `mistboard-discover://wxf-category?catid=415&tourSlug=...&tourName=...`

import type {
  DiscoveredBoard,
  DiscoveryProvider,
  DiscoveryProviderInput,
} from './xiangqi-broadcast-discovery.js';

const WXF_ORIGIN = 'https://www.wxf-xiangqi.org';

export function wxfCategoryUrl(catid: string, origin = WXF_ORIGIN, lang = 'cn'): string {
  // limit=0 asks Joomla for every article on one page; the site's own default
  // for these categories is already "all", this keeps a changed default from
  // paging rounds out of view.
  return `${origin}/index.php?option=com_content&view=category&id=${catid}&limit=0&lang=${lang}`;
}

/** The article's canonical address, without the alias or menu item a listing adds. */
export function wxfArticleUrl(id: string, origin = WXF_ORIGIN, lang = 'cn'): string {
  return `${origin}/index.php?option=com_content&view=article&id=${id}&lang=${lang}`;
}

export type WxfCategoryArticle = { id: string; title: string; roundNumber?: number };

const CHINESE_DIGITS: Record<string, number> = {
  一: 1,
  二: 2,
  三: 3,
  四: 4,
  五: 5,
  六: 6,
  七: 7,
  八: 8,
  九: 9,
};

/** 一 .. 九十九; anything else is not a round count this site would use. */
function chineseNumber(text: string): number | undefined {
  const match = text.match(/^([一二三四五六七八九])?(十)?([一二三四五六七八九])?$/);
  if (!match || (!match[1] && !match[2] && !match[3])) return undefined;
  if (!match[2]) return match[3] ? undefined : CHINESE_DIGITS[match[1] ?? ''];
  const tens = match[1] ? (CHINESE_DIGITS[match[1]] ?? 0) : 1;
  const ones = match[3] ? (CHINESE_DIGITS[match[3]] ?? 0) : 0;
  return tens * 10 + ones;
}

/** The round an article title states: 第9轮, 第十轮, Round 9, R9. */
export function wxfTitleRoundNumber(title: string): number | undefined {
  const arabic =
    title.match(/第\s*(\d{1,2})\s*轮/)?.[1] ??
    title.match(/\bRound\s*0*(\d{1,2})(?!\d)/i)?.[1] ??
    title.match(/\bR0*(\d{1,2})(?!\d)/)?.[1];
  const parsed = arabic !== undefined ? Number(arabic) : undefined;
  if (parsed !== undefined && Number.isInteger(parsed) && parsed > 0) return parsed;
  const chinese = title.match(/第\s*([一二三四五六七八九十]{1,3})\s*轮/)?.[1];
  return chinese ? chineseNumber(chinese) : undefined;
}

function decodeEntities(value: string): string {
  return value
    .replaceAll('&amp;', '&')
    .replaceAll('&quot;', '"')
    .replaceAll('&#39;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)));
}

/**
 * The articles a category listing names, in the listing's order.
 *
 * Only the category table is read: the page's menus link articles too (the
 * federation's about page, the rules), and those are not this event. A link
 * that names a different category is dropped for the same reason.
 */
export function parseWxfCategoryListing(html: string, catid: string): WxfCategoryArticle[] {
  const table = html.match(/<table[^>]*class="[^"]*\bcategory\b[^"]*"[^>]*>([\s\S]*?)<\/table>/i);
  if (!table) return [];
  const articles: WxfCategoryArticle[] = [];
  const seen = new Set<string>();
  for (const link of (table[1] ?? '').matchAll(/<a\s[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(link[1] ?? '');
    if (!/[?&]view=article\b/.test(href)) continue;
    const id = href.match(/[?&]id=(\d+)/)?.[1];
    if (id === undefined || seen.has(id)) continue;
    const linkCat = href.match(/[?&]catid=(\d+)/)?.[1];
    if (linkCat !== undefined && linkCat !== catid) continue;
    seen.add(id);
    const title = decodeEntities((link[2] ?? '').replace(/<[^>]+>/g, ''))
      .replace(/\s+/g, ' ')
      .trim();
    const roundNumber = wxfTitleRoundNumber(title);
    articles.push({ id, title, ...(roundNumber !== undefined ? { roundNumber } : {}) });
  }
  return articles;
}

async function fetchText(
  input: DiscoveryProviderInput,
  url: string,
): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);
  try {
    const response = await input.fetchImpl(url, { signal: controller.signal });
    if (!response.ok) return { ok: false, message: `${url} responded ${response.status}` };
    return { ok: true, text: await response.text() };
  } catch (error) {
    return {
      ok: false,
      message: `${url}: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

export const wxfCategoryDiscoveryProvider: DiscoveryProvider = {
  name: 'wxf-category',
  statesRounds: true,
  async discover(input) {
    const origin = input.config.get('origin')?.trim() || WXF_ORIGIN;
    const lang = input.config.get('lang')?.trim() || 'cn';
    const catid = input.config.get('catid')?.trim();
    if (!catid || !/^\d+$/.test(catid)) {
      return { ok: false, message: 'wxf-category discovery needs a numeric catid (catid=415)' };
    }

    const listUrl = wxfCategoryUrl(catid, origin, lang);
    const list = await fetchText(input, listUrl);
    if (!list.ok) return { ok: false, message: `category listing unreachable: ${list.message}` };

    const articles = parseWxfCategoryListing(list.text, catid);
    // An article whose title states no round (a pairings sheet, a photo page)
    // is not a round of records; filing it under a guessed round is worse than
    // leaving it out.
    const rounds = articles.filter((article) => article.roundNumber !== undefined);
    if (rounds.length === 0) {
      // Normal before the event's first round goes up: the category answered
      // and lists nothing yet. Quiet, like dpxq-tour's empty game list.
      return {
        ok: false,
        message:
          articles.length === 0
            ? `category ${catid} lists no articles yet`
            : `category ${catid} lists no round articles yet`,
        quiet: true,
      };
    }

    // Articles are not fetched here: the leaf fetch downstream reads each once,
    // and buildStatedRoundManifestSources leaves out the ones already stored
    // complete, so a finished round costs nothing after its import.
    const boards: DiscoveredBoard[] = rounds.map((article) => ({
      url: wxfArticleUrl(article.id, origin, lang),
      event: article.title,
      roundNumber: article.roundNumber as number,
    }));
    return { ok: true, boards };
  },
};
