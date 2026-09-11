-- 136_users_stats_excluded.sql
-- Per-account statistics exclusion: when set, every game the account sat in
-- (and the account itself) drops out of the public /stats numbers, the
-- homepage games-played figure, the admin /metrics series, and the scheduled
-- readout. The games stay in the database and on the account's profile; only
-- the aggregate counts stop claiming them.
--
-- This exists because the operator's own accounts had played 512 of the 988
-- completed human games on 2026-09-11, and a "games played" number that is
-- half the operator testing the site is not a number about the site. PostHog
-- has filtered the same accounts as test accounts since the growth board was
-- built; the database counts now agree with it.
--
-- A timestamp rather than a boolean, matching play_disabled_at / patron_since:
-- it answers "since when" as well as "whether". NULL = counted, the default
-- for every existing row.
--
-- Deliberately NOT derived from account_role. Admin is privilege; this is
-- "not a visitor". They coincide today and will not the day someone else is
-- granted the role. Set it with scripts/account-flags.mjs --exclude-from-stats.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS stats_excluded_at TIMESTAMPTZ;
