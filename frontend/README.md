# ProjectMind AI frontend
React + Vite + Tailwind 3 + React Router + React Flow.

    npm install
    cp .env.example .env     # set VITE_API_BASE_URL to Akash's API, or leave empty for mock JSON
    npm run dev

Without VITE_API_BASE_URL the app uses `src/mock.js` and shows a banner. All dashboard counts are derived from API responses.
API paths live in `src/api.js` and are assumptions until contracts are confirmed: GET /projects, /projects/:id/{documents,events,edges}, PATCH /events/:id/review, POST /projects/:id/ask.
Status enums and field names (`eventDate`, `ingestedAt`, `confidence`, `review`, `source.{doc,quote}`) need confirming with Athish.

Not built yet: document upload, conflicts and gaps page, shadcn/ui, Recharts.
