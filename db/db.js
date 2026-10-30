/**
 * db.js - Database layer for the Temporal Product Knowledge System (Node.js).
 *
 * OWNER: database person.  USED BY: backend (require this file).
 * Uses better-sqlite3 (synchronous, fast, works fully offline once installed).
 * No HTTP in here - the backend calls these functions from its routes.
 *
 * Quick use:
 *   const db = require('./db');
 *   db.initDb('tpks.db');                         // once at startup
 *   db.ingestDocument({ sourceId, filename, events, extractedText, filePath, pageCount });
 *   db.getTimeline(1, { asOfIngestion: '2025-03-25' });
 *
 * All returned JSON uses snake_case keys (event_date, source_id ...) - the same
 * names as the ML contract, so data flows through without renaming.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const SCHEMA_PATH = path.join(__dirname, 'schema.sql');
const STATUSES = ['proposed', 'approved', 'rejected', 'implemented', 'modified', 'renamed', 'removed'];

let DB = null; // single shared connection (better-sqlite3 is synchronous)

// ------------------------------------------------------------------ errors
class DBError extends Error {
  constructor(message) { super(message); this.name = this.constructor.name; }
}
/** Bad input (wrong status, bad date...). Backend: respond 422/400. */
class ValidationError extends DBError {}
/** Feature / source does not exist. Backend: respond 404. */
class NotFoundError extends DBError {}
/** Two names already belong to different features, or source_id reused for another file. Backend: 409. */
class ConflictError extends DBError {}

// ------------------------------------------------------------------ setup
/** Open the database and create tables/indexes/triggers (safe on every startup). */
function initDb(dbPath) {
  if (DB) { try { DB.close(); } catch (_) { /* ignore */ } }
  const file = dbPath || process.env.TPKS_DB || path.join(__dirname, 'tpks.db');
  DB = new Database(file);
  DB.pragma('journal_mode = WAL');
  DB.pragma('foreign_keys = ON'); // OFF by default in SQLite - must be enabled
  DB.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
  return file;
}

function conn() {
  if (!DB) throw new DBError('Database not initialised. Call initDb() first.');
  return DB;
}

/** Run fn inside ONE transaction: commits on success, rolls back on any throw. */
function tx(fn) {
  return conn().transaction(fn)();
}

// ------------------------------------------------------------------ time helpers
// Stored as UTC 'YYYY-MM-DDTHH:MM:SSZ' so string <= comparison is chronological.
function nowTs() {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

/** 'YYYY-MM-DD' or ISO datetime -> canonical UTC string.
 *  Date-only + endOfDay=true means "through the end of that day". */
function normTs(value, endOfDay = false) {
  const v = String(value).trim();
  let dt;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) {
    if (!isValidDate(v)) throw new ValidationError(`Invalid date '${value}'. Use YYYY-MM-DD or ISO-8601.`);
    dt = new Date(`${v}T${endOfDay ? '23:59:59' : '00:00:00'}Z`);
  } else {
    const hasTz = /(Z|[+-]\d{2}:?\d{2})$/i.test(v);
    dt = new Date(hasTz ? v : `${v}Z`); // no timezone given -> treat as UTC
    if (Number.isNaN(dt.getTime())) {
      throw new ValidationError(`Invalid date/time '${value}'. Use YYYY-MM-DD or ISO-8601.`);
    }
  }
  return dt.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

const asOf = (v) => (v ? normTs(v, true) : nowTs());
const normName = (s) => String(s).replace(/\s+/g, ' ').trim();

/** LLMs often send '', 'null', 'N/A' instead of null. */
function blankToNone(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' || ['null', 'none', 'n/a'].includes(s.toLowerCase()) ? null : s;
}

// ------------------------------------------------------------------ validation
/** Check one ML event and return a clean copy. Throws ValidationError. */
function validateEvent(ev, index = 0) {
  const where = `events[${index}]`;
  if (ev === null || typeof ev !== 'object' || Array.isArray(ev)) {
    throw new ValidationError(`${where}: must be an object`);
  }
  for (const key of ['feature_name', 'status', 'event_date', 'source_id']) {
    if (!blankToNone(ev[key])) throw new ValidationError(`${where}: '${key}' is required`);
  }

  const status = String(ev.status).trim().toLowerCase();
  if (!STATUSES.includes(status)) {
    throw new ValidationError(`${where}: status '${ev.status}' must be one of ${JSON.stringify(STATUSES)}`);
  }

  const eventDate = String(ev.event_date).trim();
  if (!isValidDate(eventDate)) {
    throw new ValidationError(`${where}: event_date '${ev.event_date}' must be YYYY-MM-DD`);
  }

  let conf = ev.confidence_score;
  if (conf === undefined || conf === null || (typeof conf === 'string' && conf.trim() === '')) {
    conf = null;
  } else {
    conf = Number(conf);
    if (Number.isNaN(conf)) throw new ValidationError(`${where}: confidence_score must be a number 0-1`);
    if (conf < 0 || conf > 1) throw new ValidationError(`${where}: confidence_score must be between 0 and 1`);
  }

  const renamedFrom = blankToNone(ev.renamed_from);
  if (status === 'renamed' && !renamedFrom) {
    throw new ValidationError(`${where}: status 'renamed' requires 'renamed_from'`);
  }

  return {
    feature_name: normName(ev.feature_name),
    status,
    event_date: eventDate,
    source_id: String(ev.source_id).trim(),
    source_type: blankToNone(ev.source_type),
    summary: blankToNone(ev.summary),
    evidence_quote: blankToNone(ev.evidence_quote),
    confidence_score: conf,
    code_pr_id: blankToNone(ev.code_pr_id),
    renamed_from: renamedFrom ? normName(renamedFrom) : null,
  };
}

// ------------------------------------------------------------------ internals
/** Name -> feature id. Canonical names are also stored in `aliases`, so one lookup covers all. */
function resolveId(name) {
  const row = conn().prepare('SELECT feature_id FROM aliases WHERE alias = ?').get(name);
  return row ? row.feature_id : null;
}

function ensureAlias(featureId, alias, aliasType, effectiveDate, ingestedAt, stats) {
  const r = conn().prepare(
    `INSERT OR IGNORE INTO aliases (feature_id, alias, alias_type, effective_date, first_ingested_at)
     VALUES (?, ?, ?, ?, ?)`
  ).run(featureId, alias, aliasType, effectiveDate, ingestedAt);
  if (r.changes) stats.aliases_created += 1;
}

/** Deterministic gap/conflict rules (no ML). `events` must be sorted by event_date. */
function computeWarnings(events) {
  const warnings = [];
  for (const e of events) {
    if ((e.status === 'implemented' || e.status === 'removed') && !e.code_pr_id) {
      warnings.push({
        code: 'MISSING_PR', severity: 'warning', event_id: e.id,
        message: `'${e.status}' on ${e.event_date} (source ${e.source_id}) has no linked code PR - cannot verify it shipped.`,
      });
    }
  }
  for (const rej of events.filter((e) => e.status === 'rejected')) {
    const reapproved = events.some((a) => a.status === 'approved' && a.event_date > rej.event_date);
    if (!reapproved) {
      for (const imp of events) {
        if (imp.status === 'implemented' && imp.event_date > rej.event_date) {
          warnings.push({
            code: 'IMPLEMENTED_AFTER_REJECTION', severity: 'conflict', event_id: imp.id,
            message: `Implemented on ${imp.event_date} after rejection on ${rej.event_date} (source ${rej.source_id}) with no re-approval recorded.`,
          });
        }
      }
    }
  }
  return warnings;
}

function currentName(featureId, canonical, asOfIng) {
  const row = conn().prepare(
    `SELECT alias FROM aliases
     WHERE feature_id = ? AND alias_type = 'renamed_to' AND first_ingested_at <= ?
     ORDER BY effective_date DESC, id DESC LIMIT 1`
  ).get(featureId, asOfIng);
  return row ? row.alias : canonical;
}

function aliasesGrouped(asOfIng) {
  const out = {};
  const rows = conn().prepare(
    `SELECT feature_id, alias, alias_type, effective_date, first_ingested_at
     FROM aliases WHERE first_ingested_at <= ? ORDER BY id`
  ).all(asOfIng);
  for (const r of rows) (out[r.feature_id] = out[r.feature_id] || []).push(r);
  return out;
}

function buildTimeline(featureId, asOfIng, asOfEvent) {
  const f = conn().prepare('SELECT * FROM features WHERE id = ?').get(featureId);
  if (!f) throw new NotFoundError(`Feature ${featureId} not found`);
  let sql = `SELECT e.*, s.filename AS source_filename, s.file_path AS source_file_path
             FROM events e
             LEFT JOIN sources s ON s.source_id = CASE WHEN instr(e.source_id, '#') > 0
                  THEN substr(e.source_id, 1, instr(e.source_id, '#') - 1) ELSE e.source_id END
             WHERE e.feature_id = @fid AND e.ingestion_date <= @ing`;
  const params = { fid: featureId, ing: asOfIng };
  if (asOfEvent) { sql += ' AND e.event_date <= @ev'; params.ev = asOfEvent; }
  sql += ' ORDER BY e.event_date ASC, e.ingestion_date ASC, e.id ASC';
  const events = conn().prepare(sql).all(params);
  return {
    feature_id: f.id,
    canonical_name: f.canonical_name,
    current_name: currentName(f.id, f.canonical_name, asOfIng),
    events,
    warnings: computeWarnings(events),
  };
}

/** Write already-validated events. Must be called inside tx(). */
function ingestClean(clean, ing, batchLabel) {
  const stats = { events_created: 0, duplicates_skipped: 0, features_created: 0, aliases_created: 0 };
  const touched = new Set();
  const insertFeature = conn().prepare('INSERT INTO features (canonical_name, created_at) VALUES (?, ?)');
  const insertEvent = conn().prepare(
    `INSERT OR IGNORE INTO events
     (feature_id, status, summary, event_date, ingestion_date, confidence_score,
      evidence_quote, source_id, source_type, code_pr_id, batch_label)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`
  );

  for (const ev of clean) {
    const name = ev.feature_name;
    const old = ev.renamed_from;
    const fidName = resolveId(name);
    const fidOld = old ? resolveId(old) : null;
    if (fidName && fidOld && fidName !== fidOld) {
      throw new ConflictError(
        `'${name}' and '${old}' already belong to different features (${fidName} vs ${fidOld}). Source ${ev.source_id}.`);
    }
    let fid = fidName || fidOld;

    if (!fid) {
      // First sighting. On a rename event the OLD name is the original,
      // so it becomes the immutable canonical name.
      const base = old || name;
      fid = Number(insertFeature.run(base, ing).lastInsertRowid);
      stats.features_created += 1;
      ensureAlias(fid, base, 'canonical', base === name ? ev.event_date : null, ing, stats);
    }

    ensureAlias(fid, name, ev.status === 'renamed' ? 'renamed_to' : 'alternative', ev.event_date, ing, stats);
    if (old) ensureAlias(fid, old, 'renamed_from', null, ing, stats);

    const r = insertEvent.run(
      fid, ev.status, ev.summary, ev.event_date, ing, ev.confidence_score,
      ev.evidence_quote, ev.source_id, ev.source_type, ev.code_pr_id, batchLabel || null);
    if (r.changes) { stats.events_created += 1; touched.add(fid); } else { stats.duplicates_skipped += 1; }
  }
  return {
    ingestion_date: ing, batch_label: batchLabel || null,
    feature_ids_touched: [...touched].sort((a, b) => a - b), ...stats,
  };
}

// =====================================================================
// PUBLIC: events
// =====================================================================
/**
 * Store a batch of ML-extracted events (tickets, meeting notes...). ALL-OR-NOTHING.
 * For PDF reports prefer ingestDocument(), which also records the document.
 * @param {object[]} events
 * @param {{batchLabel?: string, ingestionDate?: string}} [opts]
 *   ingestionDate: leave empty in real use (server clock). Only for demos/tests that
 *   simulate the organizers' "later batch".
 */
function ingestEvents(events, opts = {}) {
  if (!Array.isArray(events) || events.length === 0) throw new ValidationError('events must be a non-empty list');
  const clean = events.map((e, i) => validateEvent(e, i)); // validate ALL first
  const ing = opts.ingestionDate ? normTs(opts.ingestionDate) : nowTs();
  return tx(() => ingestClean(clean, ing, opts.batchLabel));
}

// =====================================================================
// PUBLIC: documents (PDF reports)
// =====================================================================
const baseSourceId = (sid) => String(sid).split('#')[0]; // 'report.pdf#p3' -> 'report.pdf'

function sha256File(p) { return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'); }
function sha256Text(t) { return crypto.createHash('sha256').update(t, 'utf8').digest('hex'); }

function sourcePublic(row, includeText = false) {
  const d = { ...row };
  d.has_extracted_text = Boolean(d.extracted_text);
  if (!includeText) delete d.extracted_text;
  return d;
}

/** Insert a document row. Returns { row, existed }. Must be called inside tx(). */
function registerSourceRow(o) {
  const sid = String(o.sourceId || '').trim();
  if (!sid) throw new ValidationError('source_id is required');
  if (sid.includes('#')) {
    throw new ValidationError("source_id must not contain '#' (use 'file.pdf#p3' only inside events, for page-level proof)");
  }
  if (!blankToNone(o.filename)) throw new ValidationError('filename is required');
  if (o.pageCount !== undefined && o.pageCount !== null && (!Number.isInteger(o.pageCount) || o.pageCount < 1)) {
    throw new ValidationError('page_count must be a positive integer');
  }

  let hash = o.fileHash || null;
  if (!hash) {
    if (o.filePath && fs.existsSync(o.filePath) && fs.statSync(o.filePath).isFile()) hash = sha256File(o.filePath);
    else if (o.extractedText) hash = sha256Text(o.extractedText);
  }

  let row = conn().prepare('SELECT * FROM sources WHERE source_id = ?').get(sid);
  if (row && hash && row.file_hash && row.file_hash !== hash) {
    throw new ConflictError(`source_id '${sid}' is already used by a DIFFERENT file. Use a new source_id for the new version.`);
  }
  if (!row && hash) row = conn().prepare('SELECT * FROM sources WHERE file_hash = ?').get(hash); // same file, other name
  if (row) return { row, existed: true };

  const r = conn().prepare(
    `INSERT INTO sources (source_id, filename, file_type, file_path, file_hash, page_count, extracted_text, uploaded_at)
     VALUES (?,?,?,?,?,?,?,?)`
  ).run(sid, String(o.filename).trim(), o.fileType || 'pdf', o.filePath || null, hash,
        o.pageCount ?? null, o.extractedText ?? null, o.uploadedAt);
  return { row: conn().prepare('SELECT * FROM sources WHERE id = ?').get(r.lastInsertRowid), existed: false };
}

/**
 * Record an uploaded document WITHOUT events (e.g. right at upload, before ML runs).
 * Idempotent: same source_id or same file content returns the existing row.
 * @param {{sourceId:string, filename:string, fileType?:string, filePath?:string,
 *          extractedText?:string, pageCount?:number, fileHash?:string, uploadedAt?:string}} o
 */
function registerSource(o) {
  const uploadedAt = o.uploadedAt ? normTs(o.uploadedAt) : nowTs();
  const { row, existed } = tx(() => registerSourceRow({ ...o, uploadedAt }));
  return { ...sourcePublic(row), already_existed: existed };
}

/**
 * PDF-report flow: register the document AND store its extracted events in ONE
 * transaction (all-or-nothing).
 *  - Events may omit source_id (defaults to this document) or use page-level ids
 *    like 'april_report.pdf#p3'. Any other source_id is rejected.
 *  - source_type defaults to 'report'.
 *  - Uploading the same file again is detected (hash) and skipped:
 *    returns document_already_ingested = true and creates nothing.
 * @param {{sourceId:string, filename:string, events:object[], extractedText?:string,
 *          filePath?:string, fileType?:string, pageCount?:number, fileHash?:string,
 *          batchLabel?:string, ingestionDate?:string}} o
 */
function ingestDocument(o) {
  if (!Array.isArray(o.events) || o.events.length === 0) throw new ValidationError('events must be a non-empty list');
  const sid = String(o.sourceId || '').trim();

  const prepared = o.events.map((e, i) => {
    if (e === null || typeof e !== 'object' || Array.isArray(e)) throw new ValidationError(`events[${i}]: must be an object`);
    const ev = { ...e };
    const evSid = blankToNone(ev.source_id);
    if (evSid === null) ev.source_id = sid;
    else if (baseSourceId(evSid) !== sid) {
      throw new ValidationError(`events[${i}]: source_id '${evSid}' must be '${sid}' or '${sid}#<page>'`);
    }
    if (!blankToNone(ev.source_type)) ev.source_type = 'report';
    return ev;
  });
  const clean = prepared.map((e, i) => validateEvent(e, i)); // validate ALL first
  const ing = o.ingestionDate ? normTs(o.ingestionDate) : nowTs();

  return tx(() => {
    const { row, existed } = registerSourceRow({ ...o, sourceId: sid, uploadedAt: ing });
    if (existed) {
      return {
        source: sourcePublic(row), document_already_ingested: true, ingestion_date: ing,
        events_created: 0, duplicates_skipped: 0, features_created: 0, aliases_created: 0, feature_ids_touched: [],
      };
    }
    const result = ingestClean(clean, ing, o.batchLabel || o.filename);
    return { source: sourcePublic(row), document_already_ingested: false, ...result };
  });
}

/** One document + every event extracted from it (incl. page-level 'file#pN' events). */
function getSource(sourceId, opts = {}) {
  const sid = baseSourceId(String(sourceId).trim());
  const row = conn().prepare('SELECT * FROM sources WHERE source_id = ?').get(sid);
  if (!row) throw new NotFoundError(`Source '${sid}' not found`);
  const events = conn().prepare(
    `SELECT e.*, f.canonical_name FROM events e JOIN features f ON f.id = e.feature_id
     WHERE e.source_id = @sid OR substr(e.source_id, 1, length(@sid) + 1) = @sid || '#'
     ORDER BY e.event_date, e.id`
  ).all({ sid });
  return { ...sourcePublic(row, Boolean(opts.includeText)), events };
}

/** All documents known at that time, with event_count (0 = ML found nothing in it). */
function listSources(asOfIngestion) {
  const ing = asOf(asOfIngestion);
  return conn().prepare(
    `SELECT s.id, s.source_id, s.filename, s.file_type, s.file_path, s.file_hash, s.page_count, s.uploaded_at,
            (SELECT COUNT(*) FROM events e WHERE e.ingestion_date <= @ing
               AND (e.source_id = s.source_id
                    OR substr(e.source_id, 1, length(s.source_id) + 1) = s.source_id || '#')) AS event_count
     FROM sources s WHERE s.uploaded_at <= @ing ORDER BY s.uploaded_at, s.id`
  ).all({ ing });
}

// =====================================================================
// PUBLIC: reading (frontend / time-travel slider)
// =====================================================================
/** Any name/alias -> { feature_id, canonical_name, matched_alias, alias_type }, or null. */
function resolveName(name, asOfIngestion) {
  const ing = asOf(asOfIngestion);
  return conn().prepare(
    `SELECT f.id AS feature_id, f.canonical_name, a.alias AS matched_alias, a.alias_type
     FROM aliases a JOIN features f ON f.id = a.feature_id
     WHERE a.alias = ? AND a.first_ingested_at <= ?`
  ).get(normName(name), ing) || null;
}

/** Features known at that ingestion time, each with current_name + aliases. */
function listFeatures(asOfIngestion) {
  const ing = asOf(asOfIngestion);
  const rows = conn().prepare(
    `SELECT f.id, f.canonical_name, f.description,
            COUNT(e.id) AS event_count,
            MIN(e.event_date) AS first_event_date,
            MAX(e.event_date) AS last_event_date,
            (SELECT status FROM events x WHERE x.feature_id = f.id AND x.ingestion_date <= @ing
             ORDER BY x.event_date DESC, x.id DESC LIMIT 1) AS latest_status
     FROM features f
     JOIN events e ON e.feature_id = f.id AND e.ingestion_date <= @ing
     GROUP BY f.id ORDER BY f.id`
  ).all({ ing });
  const aliases = aliasesGrouped(ing);
  return rows.map((r) => ({
    ...r,
    current_name: currentName(r.id, r.canonical_name, ing),
    aliases: aliases[r.id] || [],
  }));
}

function getFeature(featureId, asOfIngestion) {
  const ing = asOf(asOfIngestion);
  const f = conn().prepare('SELECT * FROM features WHERE id = ?').get(featureId);
  if (!f) throw new NotFoundError(`Feature ${featureId} not found`);
  return {
    ...f,
    current_name: currentName(f.id, f.canonical_name, ing),
    aliases: aliasesGrouped(ing)[f.id] || [],
  };
}

/**
 * Bitemporal timeline of ONE feature + gap warnings.
 *  asOfIngestion = what the system KNEW then (slider)
 *  asOfEvent     = what had HAPPENED by this date (optional)
 */
function getTimeline(featureId, opts = {}) {
  const ing = asOf(opts.asOfIngestion);
  const ev = opts.asOfEvent ? normTs(opts.asOfEvent).slice(0, 10) : null;
  return { as_of_ingestion: ing, as_of_event: ev, ...buildTimeline(featureId, ing, ev) };
}

/** Timelines for every feature (hides features unknown at that time). */
function getAllTimelines(opts = {}) {
  const ing = asOf(opts.asOfIngestion);
  const ev = opts.asOfEvent ? normTs(opts.asOfEvent).slice(0, 10) : null;
  const ids = conn().prepare('SELECT id FROM features ORDER BY id').all().map((r) => r.id);
  const features = ids.map((id) => buildTimeline(id, ing, ev)).filter((t) => t.events.length > 0);
  return { as_of_ingestion: ing, as_of_event: ev, features };
}

/** Stops for the React time-travel slider. */
function getIngestionDates() {
  return conn().prepare(
    `SELECT ingestion_date, batch_label, COUNT(*) AS event_count
     FROM events GROUP BY ingestion_date, batch_label ORDER BY ingestion_date`
  ).all();
}

module.exports = {
  // setup + errors
  initDb, DBError, ValidationError, NotFoundError, ConflictError, STATUSES,
  // writing
  ingestEvents, ingestDocument, registerSource,
  // reading
  resolveName, listFeatures, getFeature, getTimeline, getAllTimelines,
  getIngestionDates, getSource, listSources,
  // exposed for testing / reuse
  validateEvent, computeWarnings,
};
