/**
 * test_db.js - one-command self check for the database layer.
 * Run:  node test_db.js      (or: npm test)
 * Uses a temporary database file, so it never touches your real tpks.db.
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const db = require('./db');

let passed = 0;
let failed = 0;
function check(name, condition) {
  if (condition) { passed += 1; console.log(`PASS  ${name}`); }
  else { failed += 1; console.log(`FAIL  ${name}`); }
}
/** true only if fn throws an instance of ErrClass */
function raises(ErrClass, fn) {
  try { fn(); } catch (e) { return e instanceof ErrClass; }
  return false;
}

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpks-'));
const tmp = path.join(tmpDir, 'test.db');
db.initDb(tmp);

const batch1 = [
  { feature_name: 'Social Login', status: 'proposed', event_date: '2025-03-03', source_id: 'MEET-1', source_type: 'meeting', confidence_score: 0.92, evidence_quote: "Let's add Google and Facebook login" },
  { feature_name: 'Social Login', status: 'approved', event_date: '2025-03-10', source_id: 'TICKET-42', source_type: 'ticket', confidence_score: 0.88 },
  { feature_name: 'Facebook Login', status: 'rejected', event_date: '2025-03-12', source_id: 'TICKET-43', source_type: 'ticket', confidence_score: 0.9 },
  { feature_name: 'Social Login', status: 'implemented', event_date: '2025-03-17', source_id: 'PR-101', source_type: 'pr', confidence_score: 0.95, code_pr_id: 'PR-101' },
  { feature_name: 'OTP Login', status: 'implemented', event_date: '2025-03-18', source_id: 'TICKET-60', confidence_score: 0.7, code_pr_id: '' },
  { feature_name: 'Quick Sign-in', status: 'renamed', event_date: '2025-03-19', source_id: 'TICKET-50', confidence_score: 0.91, renamed_from: 'Social Login' },
];
const batch2 = [ // late batch: an OLDER event arrives AFTER batch 1
  { feature_name: 'OTP Login', status: 'proposed', event_date: '2025-03-01', source_id: 'MEET-0', confidence_score: 0.85 },
];

console.log('\n--- INGESTION ---');
const r1 = db.ingestEvents(batch1, { batchLabel: 'batch-1', ingestionDate: '2025-03-20' });
check('batch1: 6 events, 3 features, 4 aliases',
  r1.events_created === 6 && r1.features_created === 3 && r1.aliases_created === 4);
const r2 = db.ingestEvents(batch2, { batchLabel: 'late-batch', ingestionDate: '2025-04-02' });
check('batch2: 1 event created', r2.events_created === 1);
const r3 = db.ingestEvents(batch2, { batchLabel: 'late-batch', ingestionDate: '2025-04-02' });
check('re-sending batch2 is idempotent (0 created, 1 duplicate)', r3.events_created === 0 && r3.duplicates_skipped === 1);

console.log('\n--- ALIASES / RENAMES ---');
const res = db.resolveName('Quick Sign-in');
check("'Quick Sign-in' resolves to canonical 'Social Login'", res && res.canonical_name === 'Social Login' && res.feature_id === 1);
check('alias lookup is case-insensitive', db.resolveName('quick sign-in') !== null);
check('unknown name returns null', db.resolveName('Nope') === null);
check('current_name is the new name', db.getFeature(1).current_name === 'Quick Sign-in');
check('canonical name never changed', db.getFeature(1).canonical_name === 'Social Login');

console.log('\n--- BITEMPORAL / TIME TRAVEL ---');
const tEarly = db.getTimeline(3, { asOfIngestion: '2025-03-25' });
const tLate = db.getTimeline(3, { asOfIngestion: '2025-04-05' });
check('at 03-25 OTP Login has 1 event', tEarly.events.length === 1);
check('at 04-05 OTP Login has 2 events', tLate.events.length === 2);
check('late (older) event sorts FIRST by event_date', tLate.events[0].event_date === '2025-03-01');
check('late event keeps separate ingestion_date', tLate.events[0].ingestion_date === '2025-04-02T00:00:00Z');
check('as_of_event filter works',
  db.getTimeline(1, { asOfIngestion: '2025-04-05', asOfEvent: '2025-03-10' }).events.length === 2);
check('slider stops = 2 batches', db.getIngestionDates().length === 2);
check('features visible at 03-25 = 3', db.listFeatures('2025-03-25').length === 3);
check('before any ingestion = 0 features', db.listFeatures('2025-01-01').length === 0);

console.log('\n--- GAP WARNINGS ---');
check('OTP implemented w/o PR -> MISSING_PR',
  JSON.stringify(tEarly.warnings.map((w) => w.code)) === JSON.stringify(['MISSING_PR']));
check('Social Login (has PR) -> no warnings', db.getTimeline(1).warnings.length === 0);

console.log('\n--- VALIDATION & ATOMICITY ---');
const bad = [
  { feature_name: 'Good Feature', status: 'proposed', event_date: '2025-05-01', source_id: 'X1' },
  { feature_name: 'Bad', status: 'launched', event_date: '2025-05-01', source_id: 'X2' },
];
check('invalid status rejected', raises(db.ValidationError, () => db.ingestEvents(bad)));
check('bad batch saved NOTHING (atomic)', db.resolveName('Good Feature') === null);
check('bad date rejected', raises(db.ValidationError, () => db.ingestEvents(
  [{ feature_name: 'A', status: 'proposed', event_date: '03/05/2025', source_id: 'S' }])));
check('rename without renamed_from rejected', raises(db.ValidationError, () => db.ingestEvents(
  [{ feature_name: 'A', status: 'renamed', event_date: '2025-05-01', source_id: 'S' }])));
check('confidence > 1 rejected', raises(db.ValidationError, () => db.ingestEvents(
  [{ feature_name: 'A', status: 'proposed', event_date: '2025-05-01', source_id: 'S', confidence_score: 1.5 }])));
check('unknown feature id -> NotFoundError', raises(db.NotFoundError, () => db.getTimeline(999)));

console.log('\n--- RENAME ARRIVES FIRST (old name becomes canonical) ---');
db.ingestEvents([{ feature_name: 'Dark Theme', status: 'renamed', event_date: '2025-06-01', source_id: 'T-9', renamed_from: 'Night Mode' }]);
const rr = db.resolveName('Dark Theme');
check("old name 'Night Mode' is canonical", rr && rr.canonical_name === 'Night Mode');

console.log("\n--- DB-LEVEL PROTECTION (even raw SQL can't break history) ---");
function rawBlocked(label, sql) {
  const c = new Database(tmp);
  c.pragma('foreign_keys = ON');
  try { c.exec(sql); check(label, false); } catch (_) { check(label, true); } finally { c.close(); }
}
rawBlocked('editing an event is blocked', "UPDATE events SET status='removed' WHERE id=1");
rawBlocked('deleting an event is blocked', 'DELETE FROM events WHERE id=1');
rawBlocked('renaming canonical name is blocked', "UPDATE features SET canonical_name='x' WHERE id=1");
rawBlocked('event with fake feature_id is blocked',
  "INSERT INTO events(feature_id,status,event_date,ingestion_date,source_id) VALUES (999,'proposed','2025-01-01','2025-01-01T00:00:00Z','X')");
rawBlocked('bad status value is blocked',
  "INSERT INTO events(feature_id,status,event_date,ingestion_date,source_id) VALUES (1,'launched','2025-01-01','2025-01-01T00:00:00Z','X')");

console.log('\n--- PDF REPORT STORAGE ---');
const pdfPath = path.join(tmpDir, 'april_report.pdf');
fs.writeFileSync(pdfPath, Buffer.from('%PDF-1.4 fake pdf bytes for testing'));
const pdfEvents = [
  { feature_name: 'SSO Login', status: 'proposed', event_date: '2025-04-10', evidence_quote: 'We propose SSO for enterprise users', confidence_score: 0.8 },
  { feature_name: 'SSO Login', status: 'approved', event_date: '2025-04-15', source_id: 'april_report.pdf#p3', evidence_quote: 'SSO approved by leadership' },
];
const d1 = db.ingestDocument({
  sourceId: 'april_report.pdf', filename: 'april_report.pdf', events: pdfEvents,
  extractedText: 'April report full text ...', filePath: pdfPath, pageCount: 5, ingestionDate: '2025-04-20',
});
check('PDF ingested: document stored + 2 events', d1.events_created === 2 && !d1.document_already_ingested);
check('file hash computed from the file', d1.source.file_hash.length === 64);
const src = db.getSource('april_report.pdf');
check('getSource returns both events', src.events.length === 2);
check('getSource hides long text by default', !('extracted_text' in src) && src.has_extracted_text);
check('getSource(includeText) returns text',
  db.getSource('april_report.pdf', { includeText: true }).extracted_text.startsWith('April report'));
check("page-level id 'april_report.pdf#p3' resolves to the document", db.getSource('april_report.pdf#p3').filename === 'april_report.pdf');
check("events default to source_type 'report'", src.events.every((e) => e.source_type === 'report'));
const tl = db.getTimeline(db.resolveName('SSO Login').feature_id, { asOfIngestion: '2025-04-25' });
check("timeline events carry source_filename (for 'open PDF' button)", tl.events.every((e) => e.source_filename === 'april_report.pdf'));
check('PDF events respect time-travel (invisible before upload)',
  db.listSources('2025-04-01').length === 0 && db.listSources('2025-04-25').length === 1);

const dupEvents = pdfEvents.map(({ source_id, ...rest }) => rest);
const dup = db.ingestDocument({ sourceId: 'copy_of_report.pdf', filename: 'copy_of_report.pdf', events: dupEvents, filePath: pdfPath });
check('same PDF uploaded again (new name) is skipped', dup.document_already_ingested && dup.events_created === 0);
check('same source_id + different content -> ConflictError', raises(db.ConflictError, () => db.ingestDocument({
  sourceId: 'april_report.pdf', filename: 'april_report.pdf', events: pdfEvents, extractedText: 'totally different text' })));
check('event pointing at another document rejected', raises(db.ValidationError, () => db.ingestDocument({
  sourceId: 'may_report.pdf', filename: 'may_report.pdf', extractedText: 'may text',
  events: [{ feature_name: 'X', status: 'proposed', event_date: '2025-05-01', source_id: 'other.pdf' }] })));
check('failed upload stored NOTHING (atomic)', raises(db.NotFoundError, () => db.getSource('may_report.pdf')));
check("'#' in document source_id rejected", raises(db.ValidationError, () => db.registerSource({ sourceId: 'a#b', filename: 'a.pdf' })));

db.registerSource({ sourceId: 'empty_report.pdf', filename: 'empty_report.pdf', extractedText: 'nothing useful here' });
const counts = Object.fromEntries(db.listSources().map((s) => [s.source_id, s.event_count]));
check('document with zero events is visible (event_count 0)', counts['empty_report.pdf'] === 0);
check('registerSource is idempotent',
  db.registerSource({ sourceId: 'empty_report.pdf', filename: 'empty_report.pdf', extractedText: 'nothing useful here' }).already_existed);
rawBlocked('editing a source is blocked', "UPDATE sources SET filename='x' WHERE id=1");
rawBlocked('deleting a source is blocked', 'DELETE FROM sources WHERE id=1');

console.log(`\n==== ${passed} passed, ${failed} failed ====`);
process.exit(failed ? 1 : 0);
