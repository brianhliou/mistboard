// Article slug -> page meta. Content source of truth is
// apps/web/src/articles-data.ts; this map duplicates only the share-card
// surface (title + description) plus `kind`, which decides the canonical URL
// space: kind 'rules' lives under /rules/<slug>, everything else under
// /blog/<slug>. The server can't import the web bundle, so the
// duplication is enforced by apps/web/src/articles-meta-sync.test.ts: a new
// or renamed article without a matching entry here fails web tests instead
// of shipping a wrong-direction 301 or a generic share card.
export type ArticleKind = 'rules' | 'article';

// Reachable by URL, deliberately unlisted and unindexed: /rules/shogi4 is
// linked from outside the site and stays up, but is not a Mistboard variant.
const NON_INDEXED_ARTICLE_SLUGS = new Set(['shogi4']);

// Rules pages for retired variants (docs-private/variant-retirement-plan.md,
// #396; the spec side is runtimeStatus 'retired' in packages/game, the web
// side VARIANT_PUBLIC_SURFACE_ENABLED in apps/web/src/variant-public-surfaces.ts).
// The server answers 410 Gone for these paths (server-http.ts): the id is
// known and the page is not coming back, which is what a crawler should hear
// rather than a 404 it will keep retrying. The set also keeps them out of the
// sitemap. The content files go with their variants in Stage 2 of the plan;
// a slug whose variant has been DELETED stays here for good, because without
// it an unknown /rules/<slug> 301s to /blog/<slug> and serves the app shell
// as a soft 404.
//
// This is a second copy of a list the server cannot import, so it is only safe
// because articles-meta-sync.test.ts fails when the two disagree. Do not edit
// one end alone.
const RETIRED_RULES_SLUGS = new Set([
  // deleted (Stage 2)
  'crossroads-chess',
  'dark-crazyhouse',
  'dark-crossroads-chess',
  'dark-mini-xiangqi',
  'dark-shogi',
  'drop-mini-xiangqi',
  'mini-xiangqi',
  'reveal-chess',
  'shogi',
  // retired, code still present
  'dark-draft960',
  'kriegspiel',
]);

/** A rules page whose variant is retired: served as 410 Gone. */
export function articleIsRetired(slug: string): boolean {
  return RETIRED_RULES_SLUGS.has(slug);
}

// Slugs that exist in articles-data but are not published yet. A draft is
// hidden in the production web build (the route 404s client-side), but the
// server still answers /blog/<slug> with a 200 shell and injects this file's
// title + description, so without this set a crawler sees a live page for an
// unpublished article. Kept in sync by articles-meta-sync.test.ts, which fails
// if a non-published article is missing here or a published one is still
// listed - so promoting an article to 'published' is what removes it, and
// nobody has to remember this file exists.
const UNPUBLISHED_ARTICLE_SLUGS = new Set([
  // The jieqi set (jieqi-platform, jieqi-openings and the three Vietnamese pages)
  // published together on 2026-09-03. They came out as one batch because each of
  // them links to another in prose, and a published page linking to a draft ships
  // a dead link that the CTA-only link guard does not catch.
  'fog-openings',
  'fog-chess-concepts',
]);

export function articleIsUnpublished(slug: string): boolean {
  return UNPUBLISHED_ARTICLE_SLUGS.has(slug);
}

export function articleIsIndexable(slug: string): boolean {
  return (
    !NON_INDEXED_ARTICLE_SLUGS.has(slug) &&
    !UNPUBLISHED_ARTICLE_SLUGS.has(slug) &&
    !RETIRED_RULES_SLUGS.has(slug)
  );
}

export const ARTICLE_META: Record<
  string,
  { title: string; description: string; kind: ArticleKind }
> = {
  'co-up': {
    title: 'Cờ úp trên Mistboard',
    kind: 'article',
    description:
      'Chơi cờ úp với máy hoặc với bạn bè, miễn phí và không cần tài khoản, rồi xem lại ván đấu với phân tích engine tách riêng phần may rủi khỏi phần quyết định.',
  },
  'luat-co-up': {
    title: 'Luật cờ úp',
    kind: 'article',
    description:
      'Luật cờ úp đầy đủ: cách bày quân, cách đi quân úp trước và sau khi lật, ăn quân úp, chiếu bí và các trường hợp hòa.',
  },
  'jieqi-platform': {
    title: 'Jieqi on Mistboard',
    kind: 'article',
    description:
      'A modern jieqi platform: play the engine or a friend, free and without an account, with engine analysis that handles reveals correctly.',
  },
  chess: {
    title: 'Chess Rules',
    kind: 'rules',
    description:
      'Standard chess rules, the primer behind Fog Chess: castling, promotion, en passant, the draw rules, and a famous game to play through.',
  },
  'fog-chess': {
    title: 'Fog Chess Rules',
    kind: 'rules',
    description:
      'Fog Chess rules: chess under Fog of War, where each side sees only the squares its pieces reach, there are no check warnings, and the king falls by capture.',
  },
  'fog-chess-concepts': {
    title: 'Fog Chess Concepts',
    kind: 'article',
    description:
      'Strategy concepts for Fog Chess: read fogged squares and capture clues, model the hidden positions you could be facing, cluster them into the few that matter, and pick moves that survive every one.',
  },
  'xiangqi-champions': {
    title: 'Every Xiangqi Champion',
    kind: 'article',
    description:
      'Every winner of the Chinese national xiangqi championship since 1956, and an annotated game for each of the thirteen who built the game\u2019s first fifty years. Plus the nine hundred years before the title existed, and the decade that has been struck from the record.',
  },
  'xiangqi-match-fixing': {
    title: 'The Xiangqi Match-Fixing Case',
    kind: 'article',
    description:
      'Between 2024 and 2026 the Chinese Xiangqi Association sanctioned 49 people for buying and selling games, and a Hangzhou court convicted six grandmasters of bribery. What happened, why it paid, who ruled, and what is still unproven.',
  },
  'xiangqi-world-championship': {
    title: 'The Xiangqi World Championship',
    kind: 'article',
    description:
      'Every winner of the Xiangqi World Championship since 1990, why the Chinese national title is the harder one, and how a Vietnamese player took it out of China for the first time in 2025.',
  },
  'jieqi-openings': {
    title: 'What Strong Jieqi Players Believe About the Opening',
    kind: 'article',
    description:
      'Jieqi has no opening book. It has an argument about the first move, running on Chinese forums among players with thousands of games, never written down in English. Why a face-down piece is a one-shot option you can waste, five openings ranked, and the pawn push weighed against the crossed cannon on all six reveals.',
  },
  'khai-cuoc-co-up': {
    title: 'Người chơi cờ úp giỏi tin gì về khai cuộc',
    kind: 'article',
    description:
      'Cờ úp không có sách khai cuộc. Nó chỉ có một cuộc tranh luận về nước đi đầu tiên, chạy nhiều năm trên các diễn đàn Trung Quốc giữa những người chơi hàng nghìn ván, chưa từng được viết ra bằng tiếng Anh hay tiếng Việt. Vì sao một quân úp là quyền chọn dùng đúng một lần mà bạn có thể phí đi, năm khai cuộc được xếp hạng, và thế tiến tốt đặt lên bàn cân với pháo qua sông trên cả sáu khả năng lật.',
  },
  'fog-openings': {
    title: 'An Opening System for Fog Chess',
    kind: 'article',
    description:
      'A complete Fog of War chess opening system built on 1.c4 and 2.Qa4, measured across 899 games. The queen doubles as a sensor and sometimes captures the king on move three. Which Black replies hold, which collapse, and where the system stops working.',
  },
  'dark-draft960': {
    title: 'Dark Draft960',
    kind: 'rules',
    description:
      "Fog Chess with a sealed opening draft: each player picks one of three Chess960 back ranks and never sees the other's.",
  },
  xiangqi: {
    title: 'Xiangqi Rules',
    kind: 'rules',
    description:
      'The rules of xiangqi, also called Chinese chess, the primer behind Fog Xiangqi: palaces, the river, cannon screens, facing generals, and a famous game to play through.',
  },
  'fog-xiangqi': {
    title: 'Fog Xiangqi Rules',
    kind: 'rules',
    description:
      'Xiangqi under Fog of War: each side sees only the points its pieces reach, hidden blockers matter, and the general falls by capture.',
  },
  'duck-xiangqi-build': {
    title: 'Duck Xiangqi Is Live: How Not to Lose Your First Game',
    kind: 'article',
    description:
      'Chinese chess with one duck both players share. The screen you build is your opponent\u2019s, nothing warns you before your general is taken, and the bot places the duck at random.',
  },
  'duck-xiangqi': {
    title: 'Duck Xiangqi Rules',
    kind: 'rules',
    description:
      'Duck Chess on the xiangqi board: a turn is a legal move plus a duck placement, the duck screens for cannons and blocks the horse, and the general falls by capture.',
  },
  'fortress-xiangqi': {
    title: 'Fortress Xiangqi Rules',
    kind: 'rules',
    description:
      'Xiangqi with a pocket: faithful piece movement plus crazyhouse-style drops and the new Treasure piece.',
  },
  shogi4: {
    title: 'Shogi4 (4×4 Shogi) Rules',
    kind: 'rules',
    description:
      "The complete rules of Shogi4, Oca Studios' public-domain animal drop-shogi on a 4×4 board: how the Carp, Tapir, Raccoon-dog, Fox, and royal move, plus the friendly-jump, evolution, drops, and king-capture wins.",
  },
  misty: {
    title: 'How Misty Plays',
    kind: 'article',
    description:
      "Misty is Mistboard's Fog Chess engine: how it sees, searches possible boards, avoids hidden catastrophes, and where the current version stands.",
  },
  mistybanqi: {
    title: 'How MistyBanqi Plays',
    kind: 'article',
    description:
      'MistyBanqi is the engine you play in Banqi on Mistboard: a classical search engine with a hand-written evaluation. How it thinks, and the blind spot worth knowing: it can draw a game it has already won.',
  },
  'server-enforced-fog': {
    title: 'Programming Fog Chess with Server-Side Truth',
    kind: 'article',
    description:
      'How Mistboard keeps hidden information on the server: canonical state, seat-scoped views, private live rooms, and public postgame review.',
  },
  kriegspiel: {
    title: 'Kriegspiel Rules',
    kind: 'rules',
    description:
      'The complete rules of Kriegspiel, the 1899 ancestor of Fog Chess: you see only your own pieces, an umpire rejects illegal tries and announces captures, checks, and pawn tries, and checkmate wins.',
  },
  jieqi: {
    title: 'Jieqi Rules (Reveal Xiangqi)',
    kind: 'rules',
    description:
      'The complete rules of Jieqi, the hidden-piece Chinese chess variant, in English: every piece except the generals starts face-down, makes its first move as the point it stands on, and reveals itself after moving. Play it free in your browser.',
  },
  banqi: {
    title: 'Banqi Rules (Chinese Dark Chess)',
    kind: 'rules',
    description:
      'The complete rules of Banqi, also called Chinese dark chess or blind chess: flip or move one square each turn, capture by rank, cannons jump. Play it free in your browser.',
  },
  'titled-players': {
    title: 'Bring your title to Mistboard',
    kind: 'article',
    description:
      'Verified titled players get a gold badge beside their name, a coaching page students can find, and a front page that will carry their work. Verification takes about two minutes.',
  },
  'riverbank-cannon': {
    title: 'The Riverbank Cannon Problem',
    kind: 'article',
    description:
      'Red\u2019s opening cannon reaches the riverbank first, one move from firing down any of five files, and in fog you never see it coming. Whether that breaks the game came down to one elephant move, one poisoned defense, and a coin flip we priced with the engine.',
  },
  'how-puzzle-mining-works': {
    title: 'I built a xiangqi puzzle miner',
    kind: 'article',
    description:
      'A miner that reads real xiangqi games, finds the moves people got wrong, and keeps the positions where exactly one move wins. About one blunder in nine survives it. Here is the algorithm, the code, and some of what it kept and threw away.',
  },
  'puzzles-with-more-than-one-solution': {
    title: 'Puzzles with more than one solution',
    kind: 'article',
    description:
      'A solver found a real mate and was told to try again. It turned out 382 served puzzles could do that. Here is how the miner admitted them, the patch that half-fixed it, the rule lichess uses instead, and what came out of the corpus.',
  },
  'skill-vs-luck': {
    title: 'Separating Skill from Luck in Flip Games',
    kind: 'article',
    description:
      'Half the moves in banqi, jieqi, and flip jungle are dice rolls, so a chess-style review blames you for variance. Mistboard’s game review splits every flip into the decision and the tile: luck-stripped accuracy, a luck line on the advantage graph, and what 52 human-versus-engine games say about who really earned their wins.',
  },
  jungle: {
    title: 'Jungle Chess Rules (Dou Shou Qi, Animal Chess)',
    kind: 'rules',
    description:
      'The complete rules of Jungle Chess, also called Dou Shou Qi or Animal Chess: eight ranked animals on a 7×9 board, the rat beats the elephant, only the rat swims, the lion and tiger leap the rivers. Play rated games and analyse them free in your browser.',
  },
  'jungle-flip': {
    title: 'Flip Jungle Rules (Flip Dou Shou Qi)',
    kind: 'rules',
    description:
      'The complete rules of Flip Jungle, the 4×4 flip version of Jungle Chess: animals start face-down, you flip or move each turn, capture by rank, equal ranks destroy each other. Play it free in your browser.',
  },
};

export function canonicalArticleBase(slug: string): 'blog' | 'rules' {
  return ARTICLE_META[slug]?.kind === 'rules' ? 'rules' : 'blog';
}
