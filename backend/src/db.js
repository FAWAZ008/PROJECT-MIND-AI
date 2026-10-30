import pg from "pg";
import dotenv from "dotenv";
dotenv.config();
const { Pool } = pg;
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });

export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS documents (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      name TEXT NOT NULL, type TEXT DEFAULT 'OTHER', status TEXT DEFAULT 'PROCESSED',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS events (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      feature TEXT NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'UNKNOWN',
      event_date DATE, ingested_at TIMESTAMPTZ DEFAULT NOW(), confidence NUMERIC(4,3) DEFAULT 0.5,
      review TEXT DEFAULT 'PENDING', source_doc TEXT, source_quote TEXT
    );
    CREATE TABLE IF NOT EXISTS edges (
      id TEXT PRIMARY KEY, project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
      source_event_id TEXT REFERENCES events(id) ON DELETE CASCADE,
      target_event_id TEXT REFERENCES events(id) ON DELETE CASCADE, type TEXT NOT NULL
    );
  `);
  await pool.query(`INSERT INTO projects(id,name) VALUES('p1','Sample project') ON CONFLICT DO NOTHING`);
  await pool.query(`
    INSERT INTO documents(id,project_id,name,type,status) VALUES
    ('d1','p1','issue-142.md','GITHUB_ISSUE','PROCESSED'),
    ('d2','p1','meeting-2025-03-04.txt','MEETING_NOTES','PROCESSED'),
    ('d3','p1','prd-v2.pdf','PRD','PROCESSED')
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO events(id,project_id,feature,type,status,event_date,ingested_at,confidence,review,source_doc,source_quote) VALUES
    ('e1','p1','Dark mode','PROPOSAL','PROPOSED','2025-01-12','2025-06-01',0.93,'CONFIRMED','issue-142.md','Add a dark theme to the settings page.'),
    ('e2','p1','Dark mode','APPROVAL','APPROVED','2025-03-04','2025-06-01',0.81,'PENDING','meeting-2025-03-04.txt','Team agreed to ship dark mode in the next release.'),
    ('e3','p1','Dark mode','IMPLEMENTATION','IMPLEMENTED','2025-04-20','2025-06-02',0.55,'PENDING','pr-231.md','Implements theme toggle; closes #142.'),
    ('e4','p1','Dark mode','DEPRECATION','CONFLICT','2025-05-30','2025-06-02',0.70,'PENDING','prd-v2.pdf','Dark mode is postponed until the design system lands.')
    ON CONFLICT DO NOTHING
  `);
  await pool.query(`
    INSERT INTO edges(id,project_id,source_event_id,target_event_id,type) VALUES
    ('x1','p1','e1','e2','DECIDED_BY'),
    ('x2','p1','e3','e1','INTRODUCES'),
    ('x3','p1','e4','e3','CONTRADICTS')
    ON CONFLICT DO NOTHING
  `);
}