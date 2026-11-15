-- Code selects Misty's FFQ engine; the stored profile authorizes the pair.
-- The hidden launch surface keeps the variant off public bot cards until launch.
UPDATE bot_profiles
SET supported_game_spec_ids = array_append(supported_game_spec_ids, 'ffq-banqi'),
    updated_at = now()
WHERE id = 'misty'
  AND NOT ('ffq-banqi' = ANY (supported_game_spec_ids));
