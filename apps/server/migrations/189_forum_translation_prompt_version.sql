-- Durable forum translations are read by normalized text + plan shape + locale.
-- Model and prompt version record provenance; changing either keeps stored
-- translations readable. Prefer the current prompt, otherwise the newest row.
-- The model remains in the primary key so different models' rows can coexist.
-- Legacy rows retain a NULL prompt version and their original hashes: reads
-- try the fixed legacy v2 hash only after a durable-key miss, never a v1 hash.
ALTER TABLE forum_translations ADD COLUMN prompt_version TEXT;
