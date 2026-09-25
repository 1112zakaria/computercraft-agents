ALTER TABLE worker_observations
  ADD COLUMN IF NOT EXISTS peripherals_json JSONB;
