-- Jieqi jqe-v1 chase losses have a distinct reason. Legacy chasing means perpetual check.
-- Add the value without rewriting any stored result.
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
        'perpetual-chase',
        'dead-position',
        'points'
      )
    );
