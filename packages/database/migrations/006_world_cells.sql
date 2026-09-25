CREATE TABLE world_cells (
  dimension INTEGER NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  z INTEGER NOT NULL,
  block_name TEXT,
  block_metadata INTEGER,
  walkable BOOLEAN NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  source_worker_id BIGINT REFERENCES workers(id) ON DELETE SET NULL,
  PRIMARY KEY (dimension, x, y, z)
);

CREATE INDEX world_cells_observed_idx ON world_cells (observed_at DESC);
