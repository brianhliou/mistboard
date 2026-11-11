-- Offline Jieqi reveal luck, keyed like room decisions (first move = ply 1).
CREATE TABLE study_chapter_decisions (
  chapter_id TEXT PRIMARY KEY REFERENCES study_chapters(id) ON DELETE CASCADE,
  engine_id TEXT NOT NULL,
  source TEXT NOT NULL,
  decisions JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- A chapter is mutable; numbers imported for a former line must never label a new one.
CREATE FUNCTION clear_changed_study_decisions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.root IS DISTINCT FROM NEW.root OR OLD.variant IS DISTINCT FROM NEW.variant THEN
    DELETE FROM study_chapter_decisions WHERE chapter_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER study_decisions_tree_changed AFTER UPDATE ON study_chapters
FOR EACH ROW EXECUTE FUNCTION clear_changed_study_decisions();
