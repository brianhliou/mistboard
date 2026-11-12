import { describe, expect, it } from 'vitest';
import {
  displayParticipantName,
  MISTBOARD_ENGINE_MISTY_ID,
  MISTBOARD_ENGINE_MISTY_NAME,
  participantForColor,
} from './game-display.js';
import { homepageShowcaseGames, pickHeroPovForGame } from './landing-showcase.js';

describe('homepageShowcaseGames', () => {
  it('presents every side as the current Misty engine', () => {
    for (const game of homepageShowcaseGames()) {
      for (const color of ['white', 'black'] as const) {
        // The seat is the exact build; the homepage shows Misty named after
        // the game it plays (every showcase game is Fog Chess).
        expect(game.variant).toBe('dark-chess');
        expect(displayParticipantName(game, color)).toBe('Misty Fog Chess');
        expect(participantForColor(game, color)).toMatchObject({
          color,
          displayName: MISTBOARD_ENGINE_MISTY_NAME,
          subjectType: 'engine-version',
          subjectId: MISTBOARD_ENGINE_MISTY_ID,
        });
      }
    }
  });

  it('shows the winning side as the homepage replay POV', () => {
    for (const game of homepageShowcaseGames()) {
      const winner = game.result === 'black-wins' ? 'black' : 'white';
      // Self-play carries no fixed player side, so POV follows the winner.
      expect(game.playerColor).toBeUndefined();
      expect(pickHeroPovForGame(game)).toBe(winner);
    }
  });
});
