-- 154_data_files_withhold_hidden_piece.sql
-- /data stops offering jieqi, banqi and jungle-flip until their export can be
-- replayed (#484; DATA_WITHHELD_VARIANTS in game-data-files.ts). A stored file
-- is served as stored, so the all-variants files built before this change
-- would keep serving those games: drop them, and they rebuild without them on
-- the next download. The withheld variants' own files are unreachable now
-- (their paths 404); drop them too, since #484 changes their contents and
-- would have to rebuild them anyway. Collections are left alone.

DELETE FROM game_data_files
WHERE kind = 'monthly'
  AND (
    file_key LIKE 'monthly/%/all.%'
    OR file_key ~ '^monthly/[^/]+/(jieqi|banqi|jungle-flip)\.'
  );
