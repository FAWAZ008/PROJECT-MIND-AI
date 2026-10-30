# ProjectMind AI Backend

Backend scaffold matched to the uploaded frontend's actual `src/api.js` and UI field names.

## Setup
1. Create PostgreSQL database: `createdb projectmind`
2. Copy `.env.example` to `.env`; set your PostgreSQL password in `DATABASE_URL`.
3. Run `npm install`
4. Run `npm run dev`

API base: `http://localhost:4000`

## Routes
- `GET /health`
- `GET /projects`, `POST /projects`
- `GET /projects/:id/documents`
- `GET /projects/:id/events`
- `PATCH /events/:id/review`
- `GET /projects/:id/edges`
- `POST /projects/:id/ask`

## Frontend connection
In the frontend `.env` file:
`VITE_API_BASE_URL=http://localhost:4000`

Restart Vite after changing `.env`.

## MVP limitations
- Demo rows are seeded for project `p1`.
- Document endpoint returns metadata only; upload and parsing are not implemented.
- Ask endpoint returns evidence-shaped MVP output, not Gemini-generated reasoning.
- No authentication, authorization, or file storage yet.
- Confirm review/status enum expectations with the frontend owner before production use.
