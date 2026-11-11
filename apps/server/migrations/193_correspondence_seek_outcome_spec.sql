-- 193_correspondence_seek_outcome_spec.sql
-- Keep the variant of a closed correspondence seek for the landing-page gate.
--
-- Accept, cancel, decline and the expiry sweep delete the seek row. Cancelled
-- and declined challenges have neither a room nor an expiry notice from which
-- to recover the variant, so copy it into every new outcome before it is lost.
-- Existing outcomes stay null; only their creator and named target may see
-- them unless a room or expiry notice still identifies the variant.

ALTER TABLE correspondence_seek_outcomes ADD COLUMN IF NOT EXISTS game_spec_id TEXT;
