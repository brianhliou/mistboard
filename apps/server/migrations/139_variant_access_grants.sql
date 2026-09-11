-- 139_variant_access_grants.sql
-- Per-account access to a gated variant.
--
-- Mistboard has had exactly two per-account switches (the admin role, and the
-- play lock in 126), and neither can express "these five people may play this
-- one variant". That gap is why a variant whose rules are written but not yet
-- trusted has had only two states: off for everyone, or on for everyone. Duck
-- Xiangqi has sat in the first since it landed.
--
-- Mahjong is the case that forced it. Its hand mathematics is proven against an
-- independent implementation, but every faan value in it was read off sources
-- that disagree with each other, and nobody on this project plays Hong Kong
-- mahjong. It needs to be playable by a named handful of people who know they
-- are checking the scoring, and by nobody else, until that is settled.
--
-- Scoped to a game spec rather than a free-text feature name on purpose: the
-- spec ids are a closed union in packages/game, so a grant either names a
-- variant this codebase has or it names nothing, and the read path treats an
-- unrecognized row as no grant.
--
-- No CHECK constraint on game_spec_id, deliberately. The union gains members
-- regularly and a CHECK would owe a migration every time (see the note that
-- user_ratings owes one for duck_xiangqi). Nothing keys behaviour off an
-- unknown value: access is consulted only for specs the server already
-- considers allowlist-gated, so a stale or misspelled row grants nothing.

CREATE TABLE IF NOT EXISTS variant_access_grants (
  user_id      TEXT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- A GameSpecId value, e.g. 'mahjong'. Matched exactly.
  game_spec_id TEXT        NOT NULL,
  granted_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- Why this account has it: 'hk mahjong tester, reddit'. Operator note, never
  -- shown to the player. Nothing parses it.
  note         TEXT,
  PRIMARY KEY (user_id, game_spec_id)
);

-- The read is always "what may this account play", on the seat-assignment path,
-- so the primary key's leading column already serves it. The reverse question
-- ("who are my testers") is an operator query over a table with tens of rows.
