-- 162_feedback_triage.sql
-- Triage state for /contact feedback. Until now nothing read the table: every
-- submission was emailed to an inbox agents cannot open and otherwise sat
-- here unseen. `scripts/feedback-inbox.mjs` lists the untriaged rows and
-- `scripts/feedback-mark.mjs` is the one writer of these columns, run by a
-- session after Brian decides what a message is and what to do with it.
--
-- triage_status: new (nobody has looked), triaged (decided, action open),
-- done (action finished or nothing to do), spam. Existing rows take the
-- default and backfill to 'new'.
-- triage_class is validated by the script, not a constraint, so a new class
-- is a one-line script change rather than a migration.

ALTER TABLE feedback_submissions
  ADD COLUMN IF NOT EXISTS triage_status TEXT NOT NULL DEFAULT 'new',
  ADD COLUMN IF NOT EXISTS triage_class TEXT,
  ADD COLUMN IF NOT EXISTS triage_note TEXT,
  ADD COLUMN IF NOT EXISTS triaged_at TIMESTAMPTZ;

ALTER TABLE feedback_submissions
  DROP CONSTRAINT IF EXISTS feedback_submissions_triage_status_check;
ALTER TABLE feedback_submissions
  ADD CONSTRAINT feedback_submissions_triage_status_check
  CHECK (triage_status IN ('new', 'triaged', 'done', 'spam'));
