// One drop pocket (a side's hand of captured pieces) drawn into a host strip,
// shared by every xiangqi drop variant (Fortress, Crazyhouse) so the live room,
// the review rail and the postgame cannot disagree about what a hand looks like.
//
// Two shapes:
//   - the POCKET (`pocket: true`): the lichess crazyhouse pocket. Every droppable
//     role has a slot in a fixed order, held roles in full colour, roles held
//     none of drawn faded in place, a count badge from two up. A piece always
//     appears in the same slot, so a capture fills a gap instead of reflowing
//     the row, and the bar states what CAN be dropped. Styled by `.drop-pocket`
//     in drop-reserve.css.
//   - the legacy strip (`allRoles` alone, or neither): the replay panes, the
//     puzzles and the embed keep their own tuned layouts on these.

export type DropPocketEntry<Role extends string> = { role: Role; count: number };

export interface FillDropPocketOptions<Role extends string> {
  /** The hand's colour, for labels and the `data-hand` hook. */
  owner: string;
  /** Every droppable role in display order, with how many the owner holds. */
  entries: readonly DropPocketEntry<Role>[];
  /** Draw the lichess pocket (implies allRoles). */
  pocket?: boolean;
  /** Draw a slot for every role, ghosting the empty ones, without the pocket bar. */
  allRoles?: boolean;
  /** Tiles become buttons (the side to move's own hand). */
  interactive?: boolean;
  selectedRole?: Role | null;
  onSelect?(role: Role): void;
  /** The piece art for one role in the owner's colour (the reader's piece set). */
  renderPiece(role: Role): string;
}

export function fillDropPocket<Role extends string>(
  host: HTMLElement,
  options: FillDropPocketOptions<Role>,
): void {
  const allRoles = options.pocket === true || options.allRoles === true;
  host.classList.add('drop-mini-reserve-strip');
  host
    .closest<HTMLElement>('.board-shell, .replay-pane')
    ?.classList.add('drop-mini-reserve-container');
  host.replaceChildren();
  host.dataset.hand = options.owner;
  host.classList.toggle(
    'has-captures',
    options.entries.some((entry) => entry.count > 0),
  );
  host.classList.toggle('drop-mini-reserve-strip--all-roles', allRoles);
  host.classList.toggle('drop-pocket', options.pocket === true);
  const entries = allRoles ? options.entries : options.entries.filter((entry) => entry.count > 0);
  if (options.pocket) host.style.setProperty('--pocket-slots', String(entries.length));
  else host.style.removeProperty('--pocket-slots');
  if (entries.length === 0) return;

  const row = document.createElement('div');
  row.className = 'drop-mini-reserve-row';
  for (const entry of entries) {
    const selected = options.selectedRole === entry.role;
    const tile = options.interactive
      ? document.createElement('button')
      : document.createElement('span');
    tile.className = [
      'drop-mini-reserve-piece',
      entry.count > 1 ? 'has-count' : '',
      entry.count === 0 ? 'is-empty' : '',
      selected ? 'selected' : '',
    ]
      .filter(Boolean)
      .join(' ');
    tile.dataset.role = entry.role;
    if (tile instanceof HTMLButtonElement) {
      tile.type = 'button';
      // A faded slot holds space for a piece you do not have; it is not a
      // control, so it stays out of the tab order and ignores clicks.
      tile.disabled = entry.count === 0;
      tile.dataset.drop = entry.role;
      tile.setAttribute('aria-grabbed', selected ? 'true' : 'false');
      tile.addEventListener('click', () => options.onSelect?.(entry.role));
    }
    tile.setAttribute('aria-label', `${options.owner} ${entry.role} x${entry.count}`);
    tile.innerHTML = options.renderPiece(entry.role);
    if (entry.count > 1) {
      const badge = document.createElement('span');
      badge.className = 'captures-count-badge';
      badge.textContent = String(entry.count);
      tile.append(badge);
    }
    row.append(tile);
  }
  host.append(row);
}
