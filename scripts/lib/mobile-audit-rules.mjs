// Mechanical phone-layout rules for scripts/mobile-audit.mjs.
//
// The runner measures a page in the browser (measurePage, below, runs inside
// page.evaluate and must stay self-contained: no imports, no closures over
// module scope). judgePage turns those measurements into findings. The split
// keeps the verdicts unit-testable without a browser
// (scripts/mobile-audit-rules.test.mjs).
//
// Severity:
//   fail  something a phone reader cannot get past: the page scrolls sideways,
//         content sits off-screen with no way to reach it, a board page cannot
//         show the board and the move arrows at once, a control under 24px.
//   warn  degraded but usable: controls under the 40px tap floor, text clipped
//         by its own box, form fields under 16px (iOS zooms the page on focus),
//         body text under 11px.

export const TAP_TARGET_MIN = 40;
export const TAP_TARGET_HARD_MIN = 24;
export const INPUT_FONT_MIN = 16;
export const TINY_TEXT_PX = 11;

// Runs in the page. Returns plain JSON.
export function measurePage(options) {
  const { tapMin, inputFontMin, tinyTextPx, deviceWidth, deviceHeight } = options;
  // Judge against the device's screen, not innerWidth: mobile Chrome widens
  // the layout viewport (and zooms the page out) to fit content wider than the
  // screen, so innerWidth grows with the very overflow being looked for.
  const layoutWidth = window.innerWidth;
  const vw = deviceWidth ?? window.innerWidth;
  const vh = deviceHeight ?? window.innerHeight;
  const scrollY = window.scrollY;
  const html = document.documentElement;

  const isShown = (el) => {
    if (!(el instanceof Element)) return false;
    if (el.closest('[hidden], [aria-hidden="true"], [inert]')) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    if (Number(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const describe = (el) => {
    const tag = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : '';
    const cls =
      typeof el.className === 'string' && el.className.trim()
        ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}`
        : '';
    return `${tag}${id}${cls}`;
  };

  const label = (el) =>
    (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 40);

  const docRect = (el) => {
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top + scrollY),
      bottom: Math.round(r.bottom + scrollY),
      left: Math.round(r.left),
      right: Math.round(r.right),
      width: Math.round(r.width),
      height: Math.round(r.height),
    };
  };

  const positionedFixed = (el) => {
    for (let node = el; node && node !== document.body; node = node.parentElement) {
      const pos = getComputedStyle(node).position;
      if (pos === 'fixed' || pos === 'sticky') return pos;
    }
    return null;
  };

  const viewportMeta =
    document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? null;

  // Offscreen: elements whose box leaves [0, vw]. An ancestor that scrolls
  // sideways makes it reachable (a scroll strip), so it is skipped; an ancestor
  // that clips it inside the viewport hides it (clipped); otherwise it pushes
  // the page wider or is cut off by the page itself (offscreen).
  const all = [...document.body.querySelectorAll('*')];
  const offscreen = [];
  const clipped = [];
  const reported = new Set();
  for (const el of all) {
    if (el.closest('svg') && el.tagName.toLowerCase() !== 'svg') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (rect.right <= vw + 1 && rect.left >= -1) continue;
    if (!isShown(el)) continue;
    if (positionedFixed(el) === 'fixed' && (rect.left >= vw || rect.right <= 0)) continue; // closed drawer
    let verdict = 'offscreen';
    for (let a = el.parentElement; a && a !== document.body && a !== html; a = a.parentElement) {
      const s = getComputedStyle(a);
      if (s.overflowX === 'auto' || s.overflowX === 'scroll') {
        verdict = null;
        break;
      }
      if (s.overflowX === 'hidden' || s.overflowX === 'clip') {
        const ar = a.getBoundingClientRect();
        if (ar.right <= vw + 1 && ar.left >= -1) {
          // A carousel clips on purpose and pages with its own arrows.
          verdict = /carousel|slider/i.test(String(a.className)) ? null : 'clipped';
          break;
        }
      }
    }
    if (!verdict) continue;
    let parentReported = false;
    for (let a = el.parentElement; a; a = a.parentElement) {
      if (reported.has(a)) {
        parentReported = true;
        break;
      }
    }
    reported.add(el);
    if (parentReported) continue;
    const item = {
      el: describe(el),
      text: label(el),
      left: Math.round(rect.left),
      right: Math.round(rect.right),
      top: Math.round(rect.top + scrollY),
    };
    (verdict === 'offscreen' ? offscreen : clipped).push(item);
  }

  // Text cut by its own box: overflow hidden, content wider than the box, and
  // no ellipsis to say so.
  const textClipped = [];
  for (const el of all) {
    if (textClipped.length >= 20) break;
    if (!el.childNodes.length) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    const s = getComputedStyle(el);
    if (s.overflowX !== 'hidden' && s.overflowX !== 'clip') continue;
    if (s.textOverflow === 'ellipsis') continue;
    if (el.scrollWidth <= el.clientWidth + 1) continue;
    if (el.clientWidth < 4) continue; // visually-hidden pattern
    if (!isShown(el)) continue;
    textClipped.push({
      el: describe(el),
      text: label(el),
      box: el.clientWidth,
      content: el.scrollWidth,
    });
  }

  // Tap targets.
  const controlSelector = [
    'button',
    '[role="button"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[role="switch"]',
    'input:not([type="hidden"])',
    'select',
    'textarea',
    'summary',
    'nav a',
    '[role="tablist"] a',
    'a[class*="btn"]',
    'a[class*="button"]',
    'a[class*="chip"]',
    'a[class*="tab"]',
  ].join(',');
  const targets = [];
  for (const el of document.querySelectorAll(controlSelector)) {
    if (el.closest('svg')) continue;
    if (!isShown(el)) continue;
    const r = el.getBoundingClientRect();
    const small = Math.min(r.width, r.height);
    if (small >= tapMin) continue;
    // 1px visually-hidden inputs and boxes not laid out yet (a lazy image's
    // zoom button before the image loads) are not tap targets.
    if (small < 4) continue;
    // A control sitting inside a larger tappable box (label wrapping a checkbox)
    // is judged by the box.
    const wrap = el.closest('label');
    if (
      wrap &&
      Math.min(wrap.getBoundingClientRect().width, wrap.getBoundingClientRect().height) >= tapMin
    )
      continue;
    targets.push({
      el: describe(el),
      text: label(el),
      w: Math.round(r.width),
      h: Math.round(r.height),
    });
  }

  const smallInputs = [];
  for (const el of document.querySelectorAll(
    'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="range"]):not([type="button"]):not([type="submit"]), select, textarea',
  )) {
    if (!isShown(el)) continue;
    const px = Number.parseFloat(getComputedStyle(el).fontSize);
    if (px < inputFontMin) smallInputs.push({ el: describe(el), text: label(el), fontPx: px });
  }

  let tinyTextCount = 0;
  const tinyTextSamples = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenTiny = new Set();
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node.textContent.trim();
    if (text.length < 3) continue;
    const parent = node.parentElement;
    if (!parent || seenTiny.has(parent) || parent.closest('svg')) continue;
    const px = Number.parseFloat(getComputedStyle(parent).fontSize);
    if (px >= tinyTextPx) continue;
    if (!isShown(parent)) continue;
    seenTiny.add(parent);
    tinyTextCount += 1;
    if (tinyTextSamples.length < 5)
      tinyTextSamples.push({ el: describe(parent), text: text.slice(0, 30), fontPx: px });
  }

  // Board, move arrows and move list.
  const boardCandidates = document.querySelectorAll(
    [
      '[aria-label$=" board" i]',
      '[aria-label$="board" i][role="img"]',
      '.review-board-host',
      '[class*="board-wrap"]',
      '[class*="board-host"]',
      '[class*="live-board"]',
      'svg[class*="board"]',
      'svg[class*="live-svg"]',
      'canvas[class*="board"]',
    ].join(','),
  );
  let board = null;
  let boardArea = 0;
  for (const el of boardCandidates) {
    if (!isShown(el)) continue;
    const r = el.getBoundingClientRect();
    const ratio = r.width / r.height;
    if (r.width < 200 || ratio < 0.6 || ratio > 1.6) continue;
    if (r.width * r.height > boardArea) {
      boardArea = r.width * r.height;
      board = el;
    }
  }

  const findNav = (re) => {
    let best = null;
    let bestDist = Number.POSITIVE_INFINITY;
    const boardTop = board ? board.getBoundingClientRect().top : 0;
    for (const el of document.querySelectorAll('button, [role="button"], a')) {
      const name =
        `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''}`.trim();
      if (!re.test(name)) continue;
      if (!isShown(el)) continue;
      const dist = Math.abs(el.getBoundingClientRect().top - boardTop);
      if (dist < bestDist) {
        bestDist = dist;
        best = el;
      }
    }
    return best;
  };
  const prevEl = findNav(/^(previous|prev)\b.*\b(move|ply)\b|^back$|^step back|^上一[步着著]/i);
  const nextEl = findNav(/^next\b.*(move|ply)|^forward$|^step forward|^下一[步着著]/i);

  let moveListEl =
    [
      ...document.querySelectorAll(
        '.review-move-list, .move-tree, [class*="move-list"], [class*="movelist"], [class*="moves-table"]',
      ),
    ].find(isShown) ?? null;
  // A move list inside its own scroller (the room's side panel) is scrolled to
  // the latest move, so its own box can sit above the page; judge where the
  // scroller shows it.
  for (let a = moveListEl?.parentElement; a && a !== document.body; a = a.parentElement) {
    const oy = getComputedStyle(a).overflowY;
    if (oy === 'auto' || oy === 'scroll') {
      moveListEl = a;
      break;
    }
  }

  const navFixed = prevEl ? positionedFixed(prevEl) : null;

  return {
    url: location.pathname + location.search,
    title: document.title,
    vw,
    vh,
    layoutWidth,
    scrollWidth: Math.max(html.scrollWidth, document.body.scrollWidth),
    docHeight: Math.max(html.scrollHeight, document.body.scrollHeight),
    viewportMeta,
    offscreen: offscreen.slice(0, 10),
    offscreenCount: offscreen.length,
    clipped: clipped.slice(0, 10),
    clippedCount: clipped.length,
    textClipped,
    smallTargets: targets,
    smallInputs,
    tinyTextCount,
    tinyTextSamples,
    board: board ? { el: describe(board), ...docRect(board) } : null,
    prev: prevEl
      ? { el: describe(prevEl), label: label(prevEl), fixed: navFixed, ...docRect(prevEl) }
      : null,
    next: nextEl ? { el: describe(nextEl), label: label(nextEl), ...docRect(nextEl) } : null,
    moveList: moveListEl ? { el: describe(moveListEl), ...docRect(moveListEl) } : null,
  };
}

// Group small tap targets by element key so 80 move-list buttons read as one
// line, worst first.
export function groupTargets(targets) {
  const groups = new Map();
  for (const t of targets) {
    const g = groups.get(t.el) ?? {
      el: t.el,
      count: 0,
      minW: Infinity,
      minH: Infinity,
      sample: t.text,
    };
    g.count += 1;
    g.minW = Math.min(g.minW, t.w);
    g.minH = Math.min(g.minH, t.h);
    groups.set(t.el, g);
  }
  return [...groups.values()].sort((a, b) => Math.min(a.minW, a.minH) - Math.min(b.minW, b.minH));
}

// The board rule. A page passes when one scroll position shows the whole board
// and both move arrows: the vertical span from the top of the board to the
// bottom of the lower arrow fits in the viewport. A fixed or sticky arrow bar
// is always on screen, so then only the board plus the bar has to fit.
export function judgeBoardNav(m) {
  if (!m.board) return { status: 'no-board' };
  if (!m.prev || !m.next) return { status: 'no-nav', board: m.board };
  const navTop = Math.min(m.prev.top, m.next.top);
  const navBottom = Math.max(m.prev.bottom, m.next.bottom);
  let span;
  if (m.prev.fixed) {
    span = m.board.height + (navBottom - navTop);
  } else {
    span = Math.max(m.board.bottom, navBottom) - Math.min(m.board.top, navTop);
  }
  const fits = span <= m.vh;
  const gap = navTop - m.board.bottom;
  let movesWithBoard = null;
  if (m.moveList) {
    // Two rows (~52px) of the move list visible together with the board.
    const span2 =
      Math.max(m.board.bottom, m.moveList.top + 52) - Math.min(m.board.top, m.moveList.top);
    movesWithBoard = span2 <= m.vh;
  }
  return {
    status: fits ? 'fits' : 'split',
    span,
    vh: m.vh,
    gap,
    movesWithBoard,
    fixedNav: Boolean(m.prev.fixed),
  };
}

export function judgePage(m, { boardPage = false, tapHardMin = TAP_TARGET_HARD_MIN } = {}) {
  const findings = [];
  const add = (severity, rule, detail) => findings.push({ severity, rule, detail });

  if (!m.viewportMeta || !/width\s*=\s*device-width/i.test(m.viewportMeta)) {
    add('fail', 'viewport-meta', `meta viewport is ${JSON.stringify(m.viewportMeta)}`);
  }
  if (m.layoutWidth > m.vw + 1) {
    add(
      'fail',
      'page-zoomed-out',
      `content ${m.layoutWidth}px wide made the browser zoom a ${m.vw}px screen out`,
    );
  } else if (m.scrollWidth > m.vw + 1) {
    add(
      'fail',
      'page-scrolls-sideways',
      `document is ${m.scrollWidth}px wide in a ${m.vw}px viewport`,
    );
  }
  if (m.offscreenCount > 0) {
    const top = m.offscreen
      .slice(0, 3)
      .map((o) => `${o.el} [${o.left}..${o.right}]${o.text ? ` "${o.text}"` : ''}`)
      .join('; ');
    add('fail', 'content-offscreen', `${m.offscreenCount} element(s) leave the viewport: ${top}`);
  }
  if (m.clippedCount > 0) {
    const top = m.clipped
      .slice(0, 3)
      .map((o) => `${o.el} [${o.left}..${o.right}]${o.text ? ` "${o.text}"` : ''}`)
      .join('; ');
    add('warn', 'content-clipped', `${m.clippedCount} element(s) cut off by a container: ${top}`);
  }
  if (m.textClipped.length > 0) {
    const top = m.textClipped
      .slice(0, 3)
      .map((t) => `${t.el} ${t.content}>${t.box}px "${t.text}"`)
      .join('; ');
    add(
      'warn',
      'text-clipped',
      `${m.textClipped.length} text box(es) cut without an ellipsis: ${top}`,
    );
  }
  const groups = groupTargets(m.smallTargets);
  const hard = groups.filter((g) => Math.min(g.minW, g.minH) < tapHardMin);
  const soft = groups.filter((g) => Math.min(g.minW, g.minH) >= tapHardMin);
  if (hard.length) {
    add(
      'fail',
      'tap-target-tiny',
      hard
        .slice(0, 4)
        .map((g) => `${g.el} x${g.count} ${g.minW}x${g.minH}${g.sample ? ` "${g.sample}"` : ''}`)
        .join('; '),
    );
  }
  if (soft.length) {
    add(
      'warn',
      'tap-target-small',
      soft
        .slice(0, 4)
        .map((g) => `${g.el} x${g.count} ${g.minW}x${g.minH}${g.sample ? ` "${g.sample}"` : ''}`)
        .join('; '),
    );
  }
  if (m.smallInputs.length) {
    add(
      'warn',
      'input-zooms-ios',
      m.smallInputs
        .slice(0, 3)
        .map((i) => `${i.el} ${i.fontPx}px`)
        .join('; '),
    );
  }
  if (m.tinyTextCount > 0) {
    add(
      'warn',
      'tiny-text',
      `${m.tinyTextCount} text run(s) under ${TINY_TEXT_PX}px, e.g. ${m.tinyTextSamples
        .slice(0, 2)
        .map((t) => `${t.el} ${t.fontPx}px "${t.text}"`)
        .join('; ')}`,
    );
  }

  let boardNav = null;
  if (boardPage) {
    boardNav = judgeBoardNav(m);
    if (boardNav.status === 'no-board') {
      add('fail', 'board-missing', 'no board found on a board page');
    } else if (boardNav.status === 'no-nav') {
      add('warn', 'board-nav-missing', 'board found but no previous/next move controls');
    } else if (boardNav.status === 'split') {
      add(
        'fail',
        'board-nav-split',
        `board and move arrows need ${boardNav.span}px, viewport is ${boardNav.vh}px (arrows start ${boardNav.gap}px below the board)`,
      );
    }
    if (boardNav.movesWithBoard === false) {
      add(
        'warn',
        'board-moves-split',
        'the move list does not start within one screen of the board',
      );
    }
  }

  const fails = findings.filter((f) => f.severity === 'fail').length;
  const warns = findings.filter((f) => f.severity === 'warn').length;
  return { verdict: fails ? 'fail' : warns ? 'warn' : 'pass', fails, warns, findings, boardNav };
}
