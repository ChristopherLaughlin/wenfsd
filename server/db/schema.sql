-- wenFSD database schema (PostgreSQL)
-- Run via `npm run migrate` (which executes this file) or psql.

-- Tesla owners who have linked their account via OAuth
CREATE TABLE IF NOT EXISTS users (
  id            BIGSERIAL PRIMARY KEY,
  tesla_sub     TEXT UNIQUE,                 -- 'sub' claim from Tesla OIDC token
  email         TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- Social profile (opt-in). public_share controls whether the owner's handle + car data
-- appear on the regional leaderboard. tmc_username is a CLAIMED (unverified) handle —
-- TeslaMotorsClub has no login API, so we can't verify ownership.
ALTER TABLE users ADD COLUMN IF NOT EXISTS display_name TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS tmc_username TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_share BOOLEAN NOT NULL DEFAULT false;

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
  early_access      BOOLEAN NOT NULL DEFAULT false, -- Tesla Early Access Program member
  opted_in          BOOLEAN NOT NULL DEFAULT false, -- contribute to aggregate fleet stats (explicit opt-in)
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

-- Per-car PREDICTIONS, recorded at the time they're made, then SCORED against reality when
-- the car actually updates. This is the real back-test: did the next update land inside the
-- predicted window? Drives the connected-car hit-rate shown on the calibration panel.
CREATE TABLE IF NOT EXISTS predictions (
  id            BIGSERIAL PRIMARY KEY,
  vehicle_id    BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
  from_version  TEXT NOT NULL,                -- version the car was on when we predicted
  target_label  TEXT,                         -- predicted next version
  made_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  median_date   DATE,                         -- predicted median arrival
  p10_date      DATE,                         -- 80% window lower bound
  p90_date      DATE,                         -- 80% window upper bound
  scored        BOOLEAN NOT NULL DEFAULT false,
  actual_date   DATE,                         -- when the update actually arrived
  error_days    INT,                          -- actual - median (signed)
  hit           BOOLEAN,                      -- did actual fall within [p10, p90]?
  UNIQUE(vehicle_id, from_version)            -- one open prediction per car-version
);
CREATE INDEX IF NOT EXISTS idx_pred_vehicle ON predictions(vehicle_id);
CREATE INDEX IF NOT EXISTS idx_pred_scored ON predictions(scored);

-- The "Call your shot" game: an owner's wager on when their next update lands. Settled for
-- real when the car actually updates → wenPoints (risk × accuracy) feed the leaderboard.
CREATE TABLE IF NOT EXISTS guesses (
  id           BIGSERIAL PRIMARY KEY,
  vehicle_id   BIGINT REFERENCES vehicles(id) ON DELETE CASCADE,
  from_version TEXT NOT NULL,                 -- version the car was on when the guess was made
  target_label TEXT,
  guess_date   DATE NOT NULL,
  window_days  INT  NOT NULL DEFAULT 5,       -- ± tolerance (nerve level: 10/5/2)
  mult         NUMERIC NOT NULL DEFAULT 2.5,  -- payout multiplier (1 / 2.5 / 6)
  made_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  settled      BOOLEAN NOT NULL DEFAULT false,
  actual_date  DATE,
  hit          BOOLEAN,
  points       INT,
  UNIQUE(vehicle_id, from_version)            -- one live wager per car-version (re-guessable until it settles)
);
CREATE INDEX IF NOT EXISTS idx_guess_vehicle ON guesses(vehicle_id);

-- The Five Stages of wenFSD Grief: users log where they emotionally are while waiting.
CREATE TABLE IF NOT EXISTS grief_logs (
  id          BIGSERIAL PRIMARY KEY,
  user_id     BIGINT REFERENCES users(id) ON DELETE CASCADE,
  region      TEXT,
  stage       TEXT NOT NULL,                  -- denial|anger|bargaining|depression|acceptance
  predicted   TEXT,                           -- the stage wenFSD guessed
  note        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_grief_region ON grief_logs(region, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_grief_user ON grief_logs(user_id, created_at DESC);

-- Privacy-respecting visit counter for the creator dashboard. We store per-day TOTAL page
-- views (an aggregate counter) and, for rough unique counts, a salted daily hash of
-- IP+UA — NOT the IP itself, not reversible, and pruned after 90 days. No cookies, no PII.
CREATE TABLE IF NOT EXISTS daily_visits (
  day    DATE PRIMARY KEY,
  views  BIGINT NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS daily_unique_visitors (
  day           DATE NOT NULL,
  visitor_hash  TEXT NOT NULL,
  PRIMARY KEY (day, visitor_hash)
);
