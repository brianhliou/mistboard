ALTER TABLE users ADD COLUMN fair_play_marked_at TIMESTAMPTZ;

CREATE TABLE fair_play_refunds (
  marked_user_id TEXT NOT NULL REFERENCES users(id),
  game_id TEXT NOT NULL REFERENCES games(room_id),
  beneficiary_user_id TEXT NOT NULL REFERENCES users(id),
  variant TEXT NOT NULL,
  time_class TEXT NOT NULL,
  points INTEGER NOT NULL CHECK (points > 0 AND points <= 150),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (marked_user_id, game_id, beneficiary_user_id)
);
