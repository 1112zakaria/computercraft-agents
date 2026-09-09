ALTER TABLE named_locations
  ADD COLUMN IF NOT EXISTS approach_json JSONB;
