-- Remove the retired qualifier from all Pikafish bios, including unlisted
-- historical profiles. Keep each sentence and every other profile field intact.
UPDATE bot_profiles
SET bio = replace(bio, 'mainline ' || 'Pikafish', 'Pikafish'),
    updated_at = now()
WHERE strpos(bio, 'mainline ' || 'Pikafish') > 0;
