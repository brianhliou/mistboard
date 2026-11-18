-- Level 8 now serves Rapfi's strongest policy. Keep the old profile and engine
-- identity for finished games and provenance, without offering a ninth choice.
UPDATE bot_profiles
SET visibility = 'unlisted', updated_at = now()
WHERE id = 'rapfi' AND visibility <> 'unlisted';
