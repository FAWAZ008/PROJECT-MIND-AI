import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { randomUUID } from "node:crypto";
import { pool, initDb } from "./db.js";
dotenv.config();

const app = express();
app.use(cors({ origin: process.env.FRONTEND_ORIGIN || "http://localhost:5173" }));
app.use(express.json({ limit: "10mb" }));
const makeId = () => randomUUID();
const wrap = fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(next);

app.get("/health", (_req,res) => res.json({ok:true, service:"ProjectMind API"}));

app.get("/projects", wrap(async (_req,res) => {
  const { rows } = await pool.query("SELECT id,name FROM projects ORDER BY created_at DESC");
  res.json(rows);
}));

app.post("/projects", wrap(async (req,res) => {
  if (!req.body.name?.trim()) return res.status(400).json({error:"Project name required"});
  const { rows } = await pool.query("INSERT INTO projects(id,name) VALUES($1,$2) RETURNING id,name",[makeId(),req.body.name.trim()]);
  res.status(201).json(rows[0]);
}));

app.get("/projects/:id/documents", wrap(async (req,res) => {
  const { rows } = await pool.query("SELECT id,name,type,status FROM documents WHERE project_id=$1 ORDER BY created_at DESC",[req.params.id]);
  res.json(rows);
}));

app.get("/projects/:id/events", wrap(async (req,res) => {
  const { rows } = await pool.query(`
    SELECT id,feature,type,status,event_date::text AS "eventDate",
      ingested_at::date::text AS "ingestedAt", confidence::float8 AS confidence,
      review, json_build_object('doc',source_doc,'quote',source_quote) AS source
    FROM events WHERE project_id=$1 ORDER BY event_date NULLS LAST, ingested_at
  `,[req.params.id]);
  res.json(rows);
}));

app.patch("/events/:id/review", wrap(async (req,res) => {
  const { review, status } = req.body;
  const allowed = ["PENDING","CONFIRMED","CORRECTED","REJECTED"];
  if (review && !allowed.includes(review)) return res.status(400).json({error:"Invalid review value"});
  const { rows } = await pool.query(`
    UPDATE events SET review=COALESCE($1,review), status=COALESCE($2,status)
    WHERE id=$3
    RETURNING id,feature,type,status,event_date::text AS "eventDate",
      ingested_at::date::text AS "ingestedAt",confidence::float8 AS confidence,review,
      json_build_object('doc',source_doc,'quote',source_quote) AS source
  `,[review || null,status || null,req.params.id]);
  if (!rows[0]) return res.status(404).json({error:"Event not found"});
  res.json(rows[0]);
}));

app.get("/projects/:id/edges", wrap(async (req,res) => {
  const { rows } = await pool.query(`
    SELECT id,source_event_id AS "from",target_event_id AS "to",type
    FROM edges WHERE project_id=$1
  `,[req.params.id]);
  res.json(rows);
}));

app.post("/projects/:id/ask", wrap(async (req,res) => {
  const question = String(req.body.question || "").trim();
  if (!question) return res.status(400).json({error:"Question required"});
  const { rows } = await pool.query(`
    SELECT id,feature,type,status,event_date::text AS "eventDate",
      ingested_at::date::text AS "ingestedAt",confidence::float8 AS confidence,
      review,source_doc,source_quote
    FROM events WHERE project_id=$1 ORDER BY event_date NULLS LAST
  `,[req.params.id]);
  const words = question.toLowerCase().split(/\\W+/).filter(w => w.length > 2);
  const matched = rows.filter(e => words.some(w => `${e.feature} ${e.type} ${e.status} ${e.source_quote || ""}`.toLowerCase().includes(w)));
  const evidence = matched.length ? matched : rows;
  const citations = evidence.map((e,i)=>({id:`c${i+1}`,doc:e.source_doc,quote:e.source_quote}));
  const claims = evidence.map((e,i)=>({text:`${e.feature}: ${e.type} — ${e.status} (${e.eventDate || "date unknown"})`,cites:[`c${i+1}`]}));
  const conflicts = evidence.filter(e=>e.status==="CONFLICT").map(e=>`${e.feature}: conflicting record in ${e.source_doc}`);
  res.json({
    sufficient: evidence.length > 0,
    answer: evidence.length
      ? "Here are the stored project records that may answer your question. Check the cited source quotes before treating this as a confirmed explanation."
      : "There is not enough stored evidence to answer this question.",
    claims, citations, limitations:["MVP evidence retrieval only; no Gemini-generated synthesis is connected yet."], conflicts
  });
}));

app.use((err,_req,res,_next)=>{ console.error(err); res.status(500).json({error:"Internal server error",detail:err.message}); });
const port = Number(process.env.PORT || 4000);
initDb().then(()=>app.listen(port,()=>console.log(`ProjectMind API running at http://localhost:${port}`)))
  .catch(err=>{console.error("Could not initialize database:",err);process.exit(1);});