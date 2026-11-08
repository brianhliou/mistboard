-- Per-account DM reminder state. The message tuple is an account-wide
-- high-water mark: a reminder covers older unread threads too, so they cannot
-- rotate into subsequent daily reminders without a new message.
-- Keep the tuple even if the message is deleted; no message text is stored.
ALTER TABLE users
  ADD COLUMN inbox_email_sent_at TIMESTAMPTZ,
  ADD COLUMN inbox_email_last_message_id TEXT,
  ADD COLUMN inbox_email_last_message_at TIMESTAMPTZ,
  ADD CONSTRAINT users_inbox_email_delivery_complete CHECK (
    (inbox_email_sent_at IS NULL
      AND inbox_email_last_message_id IS NULL
      AND inbox_email_last_message_at IS NULL)
    OR (inbox_email_sent_at IS NOT NULL
      AND inbox_email_last_message_id IS NOT NULL
      AND inbox_email_last_message_at IS NOT NULL)
  );
