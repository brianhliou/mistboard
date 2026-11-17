-- Unlisted events remain readable by direct link, but leave public discovery.
ALTER TABLE xiangqi_broadcast_tours
  ADD COLUMN listed BOOLEAN NOT NULL DEFAULT true;
