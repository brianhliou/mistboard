import { renderXiangqiOgBoardSvg } from '@mistboard/board-render';
import { coordOf, parseJungleFen, parseStandardXiangqiFen } from '@mistboard/game';
import './history.css';
import { loginHrefForCurrentPage } from '../auth-redirect.js';
import { t } from '../i18n/catalog.js';
import { currentLocale, LOCALE_META } from '../i18n/locale.js';
import { renderJungleBoardSvg } from '../jungle-render.js';
import type { PuzzleHistoryEntry } from '../profile-puzzles.js';
import { buildNav } from '../site-shell.js';
import { xiangqiDisplayFile, xiangqiDisplayRow } from '../xiangqi-board-geometry.js';
import { renderPuzzleMenuLayout } from './puzzle-menu.js';

type HistoryEntry = PuzzleHistoryEntry & {
  fen: string | null;
  sideToMove: 'red' | 'black' | null;
};
type HistoryPage = { attempts: HistoryEntry[]; nextOffset: number | null };

/** The ledger has no mode column. Adjacent attempts within an hour form a session. */
export function puzzleHistorySessions(attempts: HistoryEntry[]): HistoryEntry[][] {
  const sessions: HistoryEntry[][] = [];
  // Pages arrive newest first; walk oldest first to apply the session rule,
  // retaining the server's deterministic tie order and the order played within each row.
  for (const attempt of [...attempts].reverse()) {
    const session = sessions.at(-1);
    const previous = session?.at(-1);
    if (previous && Date.parse(attempt.createdAt) - Date.parse(previous.createdAt) <= 3_600_000) {
      session!.push(attempt);
    } else {
      sessions.push([attempt]);
    }
  }
  return sessions.reverse();
}

export function puzzleHistoryTime(createdAt: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.floor((now - Date.parse(createdAt)) / 60_000));
  const unit = minutes < 60 ? 'minute' : minutes < 1440 ? 'hour' : 'day';
  const amount = unit === 'minute' ? minutes : Math.floor(minutes / (unit === 'hour' ? 60 : 1440));
  return new Intl.RelativeTimeFormat(LOCALE_META[currentLocale()].dateLocale, {
    numeric: 'always',
  }).format(-amount, unit);
}

function thumbnail(entry: HistoryEntry): HTMLElement {
  const link = document.createElement('a');
  link.className = `puzzle-history__attempt puzzle-history__attempt--${entry.solved ? 'solved' : 'incorrect'}`;
  link.href = `/puzzles/${encodeURIComponent(entry.puzzleId)}`;
  link.dataset.puzzleId = entry.puzzleId;
  const board = document.createElement('span');
  board.className = 'puzzle-history__board';
  board.setAttribute('aria-hidden', 'true');
  // Fail closed: a future hidden-information variant must supply a solver-view
  // thumbnail contract before this renderer can draw it. Never parse its FEN as xiangqi.
  if (entry.fen && entry.sideToMove) {
    const perspective = entry.sideToMove;
    if (entry.variant === 'xiangqi') {
      const parsed = parseStandardXiangqiFen(entry.fen);
      if (parsed.ok) {
        const pieces = Object.entries(parsed.state.board).flatMap(([square, piece]) => {
          if (!piece) return [];
          const { file, rank } = coordOf(square as keyof typeof parsed.state.board);
          return [
            {
              ...piece,
              file: xiangqiDisplayFile(file, perspective, 9),
              rank: 10 - xiangqiDisplayRow(rank, perspective, 10),
            },
          ];
        });
        board.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 275 305">${renderXiangqiOgBoardSvg(
          {
            files: 9,
            ranks: 10,
            pieces,
            riverBetweenRanks: [5, 6],
            palaces: [
              { fileLo: 3, fileHi: 5, rankLo: 1, rankHi: 3 },
              { fileLo: 3, fileHi: 5, rankLo: 8, rankHi: 10 },
            ],
            centerX: 137.5,
            y: 0,
            height: 305,
          },
        )}</svg>`;
      }
    } else if (entry.variant === 'jungle') {
      const parsed = parseJungleFen(entry.fen);
      if (parsed.ok)
        board.innerHTML = renderJungleBoardSvg(parsed.state.board, {
          perspective: entry.sideToMove,
          interactive: false,
        });
    }
  }
  const label = document.createElement('span');
  label.textContent = entry.solved
    ? t('puzzle.dashboardSolved')
    : { en: 'Incorrect', 'zh-Hans': '错误', 'zh-Hant': '錯誤' }[currentLocale()];
  link.setAttribute('aria-label', `${t('puzzle.label')}${entry.puzzleId}: ${label.textContent}`);
  link.append(board, label);
  return link;
}

export async function mountPuzzleHistory(root: HTMLElement): Promise<void> {
  const main = document.createElement('main');
  main.className = 'puzzle-history';
  const title = document.createElement('h1');
  title.textContent = t('puzzle.historyTitle');
  const content = document.createElement('div');
  const status = document.createElement('p');
  status.setAttribute('role', 'status');
  const more = document.createElement('button');
  more.type = 'button';
  more.textContent = t('site.more');
  main.append(title, content, status, more);
  root.replaceChildren(buildNav(), renderPuzzleMenuLayout('history', main));

  const attempts: HistoryEntry[] = [];
  let offset: number | null = 0;
  let busy = false;
  const render = () => {
    content.replaceChildren();
    for (const session of puzzleHistorySessions(attempts)) {
      const section = document.createElement('section');
      section.className = 'puzzle-history__session';
      const header = document.createElement('header');
      const heading = document.createElement('h2');
      heading.textContent = t('nav.puzzles');
      const time = document.createElement('time');
      time.dateTime = session.at(-1)!.createdAt;
      time.title = new Date(time.dateTime).toLocaleString(LOCALE_META[currentLocale()].dateLocale);
      time.textContent = puzzleHistoryTime(time.dateTime);
      header.append(heading, time);
      const row = document.createElement('div');
      row.className = 'puzzle-history__row';
      row.append(...session.map(thumbnail));
      section.append(header, row);
      content.append(section);
    }
    if (!attempts.length) {
      const play = document.createElement('a');
      play.href = '/puzzles';
      play.textContent = t('puzzle.dashboardEmpty');
      content.append(play);
    }
  };
  const load = async () => {
    if (busy || offset === null) return;
    busy = true;
    more.disabled = true;
    status.textContent = t('puzzle.loading');
    main.setAttribute('aria-busy', 'true');
    try {
      const response = await fetch(`/api/puzzles/history?order=newest&limit=50&offset=${offset}`, {
        credentials: 'same-origin',
      });
      if (response.status === 401) {
        attempts.length = 0;
        const signIn = document.createElement('a');
        signIn.href = loginHrefForCurrentPage();
        signIn.textContent = t('nav.signIn');
        content.replaceChildren(signIn);
        offset = null;
        status.textContent = '';
        return;
      }
      if (!response.ok) throw new Error('History unavailable');
      const page = (await response.json()) as HistoryPage;
      if (
        !Array.isArray(page.attempts) ||
        (page.nextOffset !== null &&
          (!Number.isSafeInteger(page.nextOffset) || page.nextOffset <= offset))
      )
        throw new Error('Invalid history page');
      attempts.push(...page.attempts);
      offset = page.nextOffset;
      render();
      status.textContent = '';
      more.textContent = t('site.more');
    } catch {
      status.textContent = t('stats.unavailableBody');
      more.textContent = t('puzzle.statusTryAgain');
    } finally {
      busy = false;
      more.disabled = false;
      more.hidden = offset === null;
      main.removeAttribute('aria-busy');
    }
  };
  more.addEventListener('click', () => void load());
  await load();
}
