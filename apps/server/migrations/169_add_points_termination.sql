-- 169_add_points_termination.sql
-- Xiangqi Mahjong ends a match on points: four hands are played and the seat
-- with more points wins. No existing termination says that, so the tenant
-- stored the win as 'checkmate', which every profile row and game card then
-- printed. Add 'points' to the allowlist and relabel the rows already written.
-- A tied match stays 'draw'; time, resignation and abandonment keep theirs.
--
-- Same shape as 114: drop and re-add the whole allowlist, because a CHECK
-- cannot be extended in place.

ALTER TABLE games
  DROP CONSTRAINT IF EXISTS games_termination_check,
  ADD CONSTRAINT games_termination_check
    CHECK (
      termination IS NULL
      OR termination IN (
        'king-captured',
        'general-captured',
        'timeout',
        'checkmate',
        'draw',
        'resignation',
        'engine-failure',
        'worker-aborted',
        'server-restarted',
        'abandoned',
        'abandonment',
        'no-legal-moves',
        'stalemate',
        'truncated',
        'repetition',
        'progress-clock',
        'race',
        'chasing',
        'dead-position',
        'points'
      )
    );

UPDATE games
   SET termination = 'points'
 WHERE variant = 'xiangqi-mahjong'
   AND termination = 'checkmate';
