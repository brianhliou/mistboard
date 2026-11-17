-- Misty owns every numbered Three Kingdoms/FFQ tier and the historical
-- unnumbered Three Kingdoms engine. Keep the exact engine and build while
-- moving older engine-version seats into her bot record (#1157).
-- Match both variant and engine id, leaving human and unrelated seats alone.
-- Visibility, results and ratings are unchanged. Re-running is a no-op.
UPDATE bot_profiles
SET supported_game_spec_ids = array_append(supported_game_spec_ids, 'three-kingdoms-banqi'),
    updated_at = now()
WHERE id = 'misty'
  AND NOT ('three-kingdoms-banqi' = ANY (supported_game_spec_ids));

UPDATE game_participants p
SET subject_type = 'bot',
    subject_id = 'misty',
    engine_id = p.subject_id,
    display_name = CASE
      WHEN p.subject_id = 'misty-three-kingdoms-banqi' THEN 'Misty'
      ELSE 'Misty Level ' || substring(p.subject_id FROM '-level-([1-8])$')
    END,
    bot_level = substring(p.subject_id FROM '-level-([1-8])$')::smallint
FROM games g
WHERE g.room_id = p.game_id
  AND p.subject_type = 'engine-version'
  AND ((g.variant = 'three-kingdoms-banqi'
        AND p.subject_id ~ '^misty-three-kingdoms-banqi(-level-[1-8])?$')
    OR (g.variant = 'ffq-banqi'
        AND p.subject_id ~ '^misty-ffq-banqi-level-[1-8]$'));

-- FFQ's source attribution landed earlier. Its already-correct bot seats
-- (and any existing TK bot seats) still need their recorded numbered level.
-- The unnumbered TK engine has no historical rung; leave its level unknown.
UPDATE game_participants p
SET bot_level = substring(p.engine_id FROM '-level-([1-8])$')::smallint
FROM games g
WHERE g.room_id = p.game_id
  AND p.subject_type = 'bot' AND p.subject_id = 'misty'
  AND p.bot_level IS NULL
  AND ((g.variant = 'three-kingdoms-banqi'
        AND p.engine_id ~ '^misty-three-kingdoms-banqi-level-[1-8]$')
    OR (g.variant = 'ffq-banqi'
        AND p.engine_id ~ '^misty-ffq-banqi-level-[1-8]$'));
