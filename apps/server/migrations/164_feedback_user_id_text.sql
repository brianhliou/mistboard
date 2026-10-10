-- 164_feedback_user_id_text.sql
-- feedback_submissions.user_id was UUID, but account ids are TEXT
-- ('user_<uuid>', migration 008). Every signed-in submission failed the
-- insert (logged as feedback_persist_failure) and survived only as the
-- [USER] email, so the inbox and the readout never saw one. Match users.id.

ALTER TABLE feedback_submissions
  ALTER COLUMN user_id TYPE TEXT USING user_id::text;
