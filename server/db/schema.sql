-- wenFSD database schema (PostgreSQL)
-- Run via `npm run migrate` (which executes this file) or psql.

-- Tesla owners who have linked their account via OAuth
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  tesla_sub     TEXT UNIQUE,                 -- 'sub' claim from Tesla OIDC token
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- OAuth tokens per user (refresh token is long-lived; access token short-lived).
-- NOTE: encrypt these at rest in production (e.g. pgcrypto or app-level KMS).
CREATE TABLE IF NOT EXISTS oauth_tokens (
  user_id        BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  access_token   TEXT,
  refresh_token  TEXT,
  expires_at     TIMESTAMPTZ,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One row per linked vehicle
CREATE TABLE IF NOT EXISTS vehicles (
  id                BIGSERIAL PRIMARY KEY,
  user_id           BIGINT REFERENCES users(id) ON DELETE CASCADE,
  vin               TEXT UNIQUE NOT NULL,
  model             TEXT,                     -- decoded from VIN
  model_year        INT,
  generation        TEXT,
  hardware          TEXT,                     -- AI4 / AI3 / AI2.5
  market            TEXT,                     -- Australia, United States, ...
  drive             TEXT,                     -- RHD / LHD
  current_version   TEXT,                     -- latest car_version we've seen
  earliness         DOUBLE PRECISION,         -- estimated rollout percentile 0..1
  opted_in          BOOLEAN NOT NULL DEFAULT true,  -- contribute to aggregate fleet stats
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);

-- Append-only log: every time a vehicle's software version is observed to change.
-- This is the raw data the fleet tracker + prediction model are built from.
CREATE TABLE IF NOT EXISTS version_snapshots (
  id           BIGSERIAL PRIMARY KEY,
  vehicle_id   BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
  version      TEXT NOT NULL,
  observed_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  market       TEXT,
  hardware     TEXT
);
CREATE INDEX IF NOT EXISTS idx_snap_version ON version_snapshots(version);
CREATE INDEX IF NOT EXISTS idx_snap_observed ON version_snapshots(observed_at);
CREATE INDEX IF NOT EXISTS idx_snap_vehicle ON version_snapshots(vehicle_id);

-- Derived per-version rollout stats, recomputed by the poller after each cycle.
-- first_seen + the snapshot timeline let us fit the logistic (t0, k) used for prediction.
CREATE TABLE IF NOT EXISTS firmware_versions (
  version       TEXT PRIMARY KEY,
  branch        TEXT,                         -- 'standard' | 'fsd'
  first_seen    TIMESTAMPTZ,
  install_count INT NOT NULL DEFAULT 0,
  fleet_pct     DOUBLE PRECISION,
  fit_t0        TIMESTAMPTZ,                  -- fitted rollout midpoint
  fit_k         DOUBLE PRECISION,             -- fitted steepness
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
