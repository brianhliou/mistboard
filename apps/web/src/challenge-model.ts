// Pure helpers for directed correspondence challenges (#654), shared by the
// challenge dialog and the landing play flow. The server remains authoritative
// for play locks, blocks and both players' grants.
import { DAYS_PER_MOVE_OPTIONS } from '@mistboard/game';
import {
  type CorrespondenceSpecOffer,
  correspondenceRatedAvailable,
  isCorrespondenceSpecFor,
  type StartGameInput,
  seekRequestBody,
} from './correspondence-model.js';

function normalizedHandle(handle: string | null | undefined): string {
  return (handle ?? '').trim().replace(/^@+/, '');
}

export type TargetedChallengeInput = Omit<StartGameInput, 'kind' | 'preferredColor'> & {
  preferredColor: string;
};

/** Never fall back to a public seek or a different variant for an invalid target
 * or selection. Rated follows the same correspondence gate as the dialog. */
export function targetedChallengeRequestBody(
  input: TargetedChallengeInput,
  correspondenceRatedModeEnabled = false,
  offered?: CorrespondenceSpecOffer,
):
  | { ok: true; body: Record<string, unknown> }
  | {
      ok: false;
      error:
        | 'handle_required'
        | 'correspondence_unsupported_spec'
        | 'invalid_days_per_move'
        | 'invalid_preferred_color';
    } {
  if (!normalizedHandle(input.handle)) return { ok: false, error: 'handle_required' };
  if (!isCorrespondenceSpecFor(input.gameSpecId, offered)) {
    return { ok: false, error: 'correspondence_unsupported_spec' };
  }
  if (!(DAYS_PER_MOVE_OPTIONS as readonly number[]).includes(input.daysPerMove)) {
    return { ok: false, error: 'invalid_days_per_move' };
  }
  const preferredColor = input.preferredColor;
  if (preferredColor !== 'random' && preferredColor !== 'first' && preferredColor !== 'second') {
    return { ok: false, error: 'invalid_preferred_color' };
  }
  return seekRequestBody({
    ...input,
    kind: 'direct',
    preferredColor,
    rated:
      input.rated === true &&
      correspondenceRatedAvailable(input.gameSpecId, correspondenceRatedModeEnabled),
  });
}
