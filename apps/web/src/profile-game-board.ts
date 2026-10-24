import { JUNGLE_HEIGHT, JUNGLE_WIDTH, jungleIsWater, jungleSquareOf } from '@mistboard/game';

// A profile game row's final-position thumbnail (#509), behind `?boards=1`.
// The server sends the board with the list (apps/server/src/profile-game-boards.ts),
// so nothing here fetches or replays. Like the study card thumbnails
// (study-thumbnails.ts), it is a fingerprint, not a readable position: solid
// discs by side on a faint board, no glyphs, because at row size a glyph only
// greys the disc out. Boards are drawn from Red's (White's) side.

/** Mirrors ProfileBoardMark in apps/server/src/profile-game-boards.ts. */
export type ProfileBoardMark =
  | 'red'
  | 'black'
  | 'white'
  | 'red-down'
  | 'black-down'
  | 'hidden'
  | 'duck';

/** [file from 0, rank from 1 at the bottom, mark]. */
export type ProfileBoardPiece = [number, number, ProfileBoardMark];

/** Mirrors ProfileBoardThumb in apps/server/src/profile-game-boards.ts. */
export type ProfileBoardThumb =
  | {
      shape: 'intersection';
      files: number;
      ranks: number;
      river: [number, number] | null;
      palaces: Array<[number, number, number, number]>;
      pieces: ProfileBoardPiece[];
    }
  | {
      shape: 'grid' | 'jungle' | 'chess';
      files: number;
      ranks: number;
      pieces: ProfileBoardPiece[];
    };

const CELL = 10;
const MARKS: ReadonlySet<string> = new Set<ProfileBoardMark>([
  'red',
  'black',
  'white',
  'red-down',
  'black-down',
  'hidden',
  'duck',
]);

/** The row's board cell: the thumbnail, or an empty cell of the same width when
 *  the game has no drawable position, so the list's columns stay aligned. */
export function buildProfileGameBoard(thumb: ProfileBoardThumb | null | undefined): HTMLElement {
  const cell = document.createElement('span');
  cell.className = 'profile-game-board';
  cell.setAttribute('aria-hidden', 'true');
  const svg = thumb ? profileBoardSvg(thumb) : null;
  if (svg) cell.innerHTML = svg;
  else cell.classList.add('profile-game-board-empty');
  return cell;
}

/** The thumbnail as SVG markup, or null for a board this build cannot draw. */
export function profileBoardSvg(thumb: ProfileBoardThumb): string | null {
  const { files, ranks } = thumb;
  if (!isSize(files) || !isSize(ranks)) return null;
  if (thumb.shape === 'jungle' && (files !== JUNGLE_WIDTH || ranks !== JUNGLE_HEIGHT)) return null;
  const onLines = thumb.shape === 'intersection';
  // Points sit on line crossings (a half-cell margin keeps edge discs whole) or
  // in cell centres.
  const width = onLines ? (files - 1) * CELL + CELL : files * CELL;
  const height = onLines ? (ranks - 1) * CELL + CELL : ranks * CELL;
  const px = (file: number) => CELL / 2 + file * CELL;
  const py = (rank: number) => CELL / 2 + (ranks - rank) * CELL;

  const parts: string[] = [
    `<svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid meet">`,
    `<rect class="profile-game-board__wood" x="0" y="0" width="${width}" height="${height}" rx="1.5"/>`,
  ];
  if (thumb.shape === 'intersection') {
    parts.push(
      `<path class="profile-game-board__grid" d="${linesPath(thumb, px, py)}" fill="none" stroke-width="0.6"/>`,
    );
  } else {
    parts.push(cellsMarkup(thumb.shape, files, ranks));
  }
  for (const piece of thumb.pieces) {
    const [file, rank, mark] = piece;
    if (!MARKS.has(mark) || !inRange(file, files) || !inRange(rank - 1, ranks)) continue;
    parts.push(
      `<circle class="profile-game-board__${mark}" cx="${px(file)}" cy="${py(rank)}" r="${CELL * 0.4}"/>`,
    );
  }
  parts.push('</svg>');
  return parts.join('');
}

function linesPath(
  thumb: Extract<ProfileBoardThumb, { shape: 'intersection' }>,
  px: (file: number) => number,
  py: (rank: number) => number,
): string {
  const { files, ranks, river } = thumb;
  const lastFile = files - 1;
  const d: string[] = [];
  for (let rank = 1; rank <= ranks; rank += 1) d.push(`M${px(0)} ${py(rank)}H${px(lastFile)}`);
  for (let file = 0; file <= lastFile; file += 1) {
    // Inner files stop at the river; the edge files cross it.
    if (river && file > 0 && file < lastFile) {
      d.push(`M${px(file)} ${py(ranks)}V${py(river[1])}M${px(file)} ${py(river[0])}V${py(1)}`);
    } else {
      d.push(`M${px(file)} ${py(ranks)}V${py(1)}`);
    }
  }
  for (const [fileLo, rankLo, fileHi, rankHi] of thumb.palaces) {
    d.push(
      `M${px(fileLo)} ${py(rankLo)}L${px(fileHi)} ${py(rankHi)}`,
      `M${px(fileHi)} ${py(rankLo)}L${px(fileLo)} ${py(rankHi)}`,
    );
  }
  return d.join('');
}

function cellsMarkup(shape: 'grid' | 'jungle' | 'chess', files: number, ranks: number): string {
  const cells: string[] = [];
  for (let rank = 1; rank <= ranks; rank += 1) {
    for (let file = 0; file < files; file += 1) {
      const kind =
        shape === 'chess'
          ? (file + rank) % 2 === 1
            ? 'dark'
            : null
          : shape === 'jungle' && jungleIsWater(jungleSquareOf(file, rank))
            ? 'water'
            : null;
      if (!kind) continue;
      cells.push(
        `<rect class="profile-game-board__${kind}" x="${file * CELL}" y="${(ranks - rank) * CELL}" width="${CELL}" height="${CELL}"/>`,
      );
    }
  }
  // Cell borders for banqi and jungle; a chessboard reads from its squares.
  if (shape !== 'chess') {
    const d: string[] = [];
    for (let file = 1; file < files; file += 1) d.push(`M${file * CELL} 0V${ranks * CELL}`);
    for (let rank = 1; rank < ranks; rank += 1) d.push(`M0 ${rank * CELL}H${files * CELL}`);
    cells.push(
      `<path class="profile-game-board__grid" d="${d.join('')}" fill="none" stroke-width="0.5"/>`,
    );
  }
  return cells.join('');
}

function isSize(n: number): boolean {
  return Number.isInteger(n) && n >= 2 && n <= 12;
}

function inRange(n: number, size: number): boolean {
  return Number.isInteger(n) && n >= 0 && n < size;
}
