-- A username suggestion is private account state, remembered across devices.
ALTER TABLE users ADD COLUMN username_prompt_dismissed_at TIMESTAMPTZ;
