-- =====================================================================
-- Temporal Product Knowledge System - SQLite schema
-- Safe to run multiple times (everything is IF NOT EXISTS).
-- NOTE: foreign keys are OFF by default in SQLite. The app runs
--       PRAGMA foreign_keys = ON on every connection.
-- =====================================================================

-- 1) CANONICAL FEATURES -------------------------------------------------
-- One row per real-world feature. id + canonical_name never change.
CREATE TABLE IF NOT EXISTS features (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    canonical_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
    description    TEXT,
    created_at     TEXT NOT NULL            -- ingestion timestamp (UTC ISO-8601)
);

-- Enforce immutability at DB level (not just in app code)
CREATE TRIGGER IF NOT EXISTS trg_features_immutable
BEFORE UPDATE OF id, canonical_name ON features
BEGIN
    SELECT RAISE(ABORT, 'features.id and features.canonical_name are immutable');
END;

-- 2) ALIASES ------------------------------------------------------------
-- Every name a feature was ever known by (including its canonical name),
-- so "Social Login" and "Quick Sign-in" resolve to the same feature_id.
-- alias is globally UNIQUE so a name can never be ambiguous.
CREATE TABLE IF NOT EXISTS aliases (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id        INTEGER NOT NULL REFERENCES features(id) ON DELETE RESTRICT,
    alias             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    alias_type        TEXT NOT NULL CHECK (alias_type IN
                        ('canonical','renamed_from','renamed_to','alternative')),
    effective_date    TEXT,                 -- event date the name started being used (NULL = unknown/earlier)
    first_ingested_at TEXT NOT NULL         -- lets the time-travel slider hide aliases not yet "known"
);
CREATE INDEX IF NOT EXISTS idx_aliases_feature ON aliases(feature_id);

-- 3) BITEMPORAL EVENTS ----------------------------------------------------
--   event_date     = VALID time       (when it happened in the real world)
--   ingestion_date = TRANSACTION time (when our system learned about it)
-- Append-only: history is never overwritten (triggers below).
CREATE TABLE IF NOT EXISTS events (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    feature_id       INTEGER NOT NULL REFERENCES features(id) ON DELETE RESTRICT,
    status           TEXT NOT NULL CHECK (status IN
                       ('proposed','approved','rejected','implemented',
                        'modified','renamed','removed')),
    summary          TEXT,
    event_date       TEXT NOT NULL
                       CHECK (event_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
    ingestion_date   TEXT NOT NULL,         -- UTC 'YYYY-MM-DDTHH:MM:SSZ'
    confidence_score REAL CHECK (confidence_score IS NULL OR confidence_score BETWEEN 0 AND 1),
    evidence_quote   TEXT,
    source_id        TEXT NOT NULL,         -- e.g. TICKET-42, MEET-7
    source_type      TEXT,                  -- meeting | ticket | pr | other
    code_pr_id       TEXT,                  -- NULL on an 'implemented' event => gap warning
    batch_label      TEXT,
    -- re-sending the same batch is harmless (idempotent ingestion)
    UNIQUE (feature_id, status, event_date, source_id)
);
CREATE INDEX IF NOT EXISTS idx_events_feature_event ON events(feature_id, event_date);
CREATE INDEX IF NOT EXISTS idx_events_ingestion     ON events(ingestion_date);
CREATE INDEX IF NOT EXISTS idx_events_status        ON events(status);
CREATE INDEX IF NOT EXISTS idx_events_pr            ON events(code_pr_id);

CREATE TRIGGER IF NOT EXISTS trg_events_no_update
BEFORE UPDATE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_events_no_delete
BEFORE DELETE ON events
BEGIN SELECT RAISE(ABORT, 'events are append-only'); END;

-- 4) SOURCES (uploaded documents: PDF reports etc.) ---------------------------
-- One row per uploaded document. The PDF FILE stays on disk (file_path);
-- the DB stores its metadata, hash (to block duplicate uploads) and the text
-- the ML read. events.source_id links to sources.source_id as plain text, so
-- tickets / meeting notes that were never registered here still work.
-- Page-level proof: events may use 'report.pdf#p3' (matches source 'report.pdf').
CREATE TABLE IF NOT EXISTS sources (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    source_id      TEXT NOT NULL UNIQUE,      -- e.g. 'march_report.pdf' (no '#')
    filename       TEXT NOT NULL,
    file_type      TEXT NOT NULL DEFAULT 'pdf',
    file_path      TEXT,                      -- where the backend saved the file
    file_hash      TEXT UNIQUE,               -- SHA-256; same file twice = rejected
    page_count     INTEGER,
    extracted_text TEXT,                      -- what the ML actually read (for judges)
    uploaded_at    TEXT NOT NULL              -- = ingestion time of this upload
);
CREATE INDEX IF NOT EXISTS idx_sources_uploaded ON sources(uploaded_at);

CREATE TRIGGER IF NOT EXISTS trg_sources_no_update
BEFORE UPDATE ON sources
BEGIN SELECT RAISE(ABORT, 'sources are append-only'); END;

CREATE TRIGGER IF NOT EXISTS trg_sources_no_delete
BEFORE DELETE ON sources
BEGIN SELECT RAISE(ABORT, 'sources are append-only'); END;
