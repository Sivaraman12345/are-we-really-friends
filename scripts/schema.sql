-- PostgreSQL Schema for A.W.R.F. (Are We Really Friends?)
-- Compatible with Neon PostgreSQL / Supabase / standard PostgreSQL 14+

-- 1. Tests Table
CREATE TABLE IF NOT EXISTS tests (
  id UUID PRIMARY KEY,
  relationship_type VARCHAR(50) NOT NULL,
  story_seed JSONB NOT NULL,
  parent_test_id UUID REFERENCES tests(id) ON DELETE SET NULL,
  created_by_participant_id UUID,
  root_test_id UUID NOT NULL,
  generation_depth INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tests_parent_id ON tests(parent_test_id);
CREATE INDEX IF NOT EXISTS idx_tests_root_id ON tests(root_test_id);
CREATE INDEX IF NOT EXISTS idx_tests_created_at ON tests(created_at DESC);

-- 2. Participants Table
CREATE TABLE IF NOT EXISTS participants (
  id UUID PRIMARY KEY,
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  role VARCHAR(10) NOT NULL CHECK (role IN ('A', 'B')),
  status VARCHAR(20) NOT NULL CHECK (status IN ('in_progress', 'completed')),
  display_name VARCHAR(50),
  dimension_scores JSONB,
  session_token VARCHAR(128) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_participants_test_role UNIQUE (test_id, role)
);

CREATE INDEX IF NOT EXISTS idx_participants_test_id ON participants(test_id);
CREATE INDEX IF NOT EXISTS idx_participants_session_token ON participants(session_token);

-- 3. Scenario Instances Table
CREATE TABLE IF NOT EXISTS scenario_instances (
  id UUID PRIMARY KEY,
  participant_id UUID NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
  sequence_index INTEGER NOT NULL CHECK (sequence_index >= 0 AND sequence_index < 8),
  slot_id VARCHAR(50) NOT NULL,
  variant_id VARCHAR(50) NOT NULL,
  rendered_scenario JSONB NOT NULL,
  chosen_option VARCHAR(5) CHECK (chosen_option IN ('A', 'B', 'C') OR chosen_option IS NULL),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_scenario_participant_sequence UNIQUE (participant_id, sequence_index)
);

CREATE INDEX IF NOT EXISTS idx_scenario_instances_participant ON scenario_instances(participant_id);

-- 4. Comparisons Table
CREATE TABLE IF NOT EXISTS comparisons (
  id UUID PRIMARY KEY,
  test_id UUID NOT NULL UNIQUE REFERENCES tests(id) ON DELETE CASCADE,
  bond_score INTEGER NOT NULL CHECK (bond_score >= 0 AND bond_score <= 100),
  strongest_dimension VARCHAR(50) NOT NULL,
  most_different_dimension VARCHAR(50) NOT NULL,
  friendship_type VARCHAR(100) NOT NULL,
  narrative_summary TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comparisons_test_id ON comparisons(test_id);

-- 5. Analytics Events Table
CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY,
  event_type VARCHAR(50) NOT NULL,
  test_id UUID,
  participant_id UUID,
  role VARCHAR(10),
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB
);

CREATE INDEX IF NOT EXISTS idx_events_test_id ON events(test_id);
CREATE INDEX IF NOT EXISTS idx_events_event_type ON events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
