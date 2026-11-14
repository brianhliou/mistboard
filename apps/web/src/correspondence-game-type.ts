// Casual or Rated for a new correspondence game, shared by the Start a game
// form and the challenge dialog. Decided 2026-11-12: Casual until the player
// picks one, then their last pick, so rated stays a choice the player made.
// Per browser; a forced Casual (a variant that cannot rate) is never saved.
export type CorrespondenceGameType = 'casual' | 'rated';

const STORAGE_KEY = 'mistboard.correspondenceGameType.v1';

export function storedCorrespondenceGameType(): CorrespondenceGameType {
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'rated' ? 'rated' : 'casual';
  } catch {
    return 'casual';
  }
}

export function rememberCorrespondenceGameType(value: CorrespondenceGameType): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Without storage the form opens on Casual each time.
  }
}
