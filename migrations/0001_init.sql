CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  host_token TEXT NOT NULL UNIQUE,
  spectator_token TEXT NOT NULL UNIQUE,
  mode TEXT NOT NULL CHECK(mode IN ('1p','2p')),
  status TEXT NOT NULL DEFAULT 'lobby' CHECK(status IN ('lobby','playing','results','ended')),
  current_round INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  slot INTEGER NOT NULL CHECK(slot IN (1,2)),
  display_name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  points INTEGER NOT NULL DEFAULT 0,
  UNIQUE(session_id, slot)
);

CREATE TABLE IF NOT EXISTS rounds (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  round_number INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','results','ended')),
  started_at INTEGER,
  ended_at INTEGER,
  UNIQUE(session_id, round_number)
);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  round_id TEXT REFERENCES rounds(id),
  held_by_slot INTEGER NOT NULL,
  guessed_by_slot INTEGER NOT NULL,
  name TEXT NOT NULL,
  image_key TEXT,
  revealed INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hints (
  id TEXT PRIMARY KEY,
  character_id TEXT NOT NULL REFERENCES characters(id),
  sort_order INTEGER NOT NULL DEFAULT 0,
  text_content TEXT,
  image_key TEXT,
  point_price INTEGER NOT NULL DEFAULT 10
);

CREATE TABLE IF NOT EXISTS hint_purchases (
  id TEXT PRIMARY KEY,
  hint_id TEXT NOT NULL REFERENCES hints(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  points_deducted INTEGER NOT NULL,
  purchased_at INTEGER NOT NULL,
  UNIQUE(hint_id, participant_id)
);

CREATE TABLE IF NOT EXISTS point_transactions (
  id TEXT PRIMARY KEY,
  participant_id TEXT NOT NULL REFERENCES participants(id),
  session_id TEXT NOT NULL REFERENCES sessions(id),
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS drawings (
  id TEXT PRIMARY KEY,
  round_id TEXT NOT NULL REFERENCES rounds(id),
  participant_id TEXT NOT NULL REFERENCES participants(id),
  r2_key TEXT,
  submitted INTEGER DEFAULT 0,
  submitted_at INTEGER,
  UNIQUE(round_id, participant_id)
);

CREATE INDEX IF NOT EXISTS idx_participants_session ON participants(session_id);
CREATE INDEX IF NOT EXISTS idx_rounds_session ON rounds(session_id);
CREATE INDEX IF NOT EXISTS idx_characters_session ON characters(session_id);
CREATE INDEX IF NOT EXISTS idx_hints_character ON hints(character_id);
CREATE INDEX IF NOT EXISTS idx_purchases_participant ON hint_purchases(participant_id);
CREATE INDEX IF NOT EXISTS idx_transactions_session ON point_transactions(session_id);
CREATE INDEX IF NOT EXISTS idx_drawings_round ON drawings(round_id);
