import {
  FFQ_BANQI_DAMAGE,
  type FFQBanqiPlayerView,
  ffqBanqiStateToFen,
  getFFQBanqiPlayerView,
} from '@mistboard/game';
import { type FFQBanqiEvent, ffqBanqiTenant } from './ffq-banqi-tenant.js';
import { applyTenantEvent, replayTenantEvents } from './variant-tenant/runtime.js';

type FFQBanqiPostgameSnapshot = {
  ply: number;
  view: FFQBanqiPlayerView;
  fen: string;
  damage: { red: number; black: number };
};

export function ffqBanqiPostgameHistory(events: readonly FFQBanqiEvent[]): {
  truth: FFQBanqiPostgameSnapshot[];
} {
  const created = events[0];
  if (created?.type !== 'room-created') return { truth: [] };
  let projection = replayTenantEvents(ffqBanqiTenant, [created]);
  const snapshot = (damage: { red: number; black: number }): FFQBanqiPostgameSnapshot => ({
    ply: projection.state.ply,
    view: getFFQBanqiPlayerView(projection.state, 'observer'),
    fen: ffqBanqiStateToFen(projection.state),
    damage,
  });
  const truth = [snapshot({ red: 0, black: 0 })];
  for (const event of events.slice(1)) {
    const captureCount = projection.state.captures.length;
    projection = applyTenantEvent(ffqBanqiTenant, projection, event);
    if (event.type !== 'move-played') continue;
    const damage = { red: 0, black: 0 };
    const capture = projection.state.captures[captureCount];
    // Nominal capture damage, including an overkill that clamps HP at zero.
    // The capture ledger is public even for covered victims.
    if (capture) damage[capture.owner] = FFQ_BANQI_DAMAGE[capture.role];
    truth.push(snapshot(damage));
  }
  // Include the terminal status in the last frame without inventing a ply.
  if (truth.length)
    truth[truth.length - 1]!.view = getFFQBanqiPlayerView(projection.state, 'observer');
  return { truth };
}
