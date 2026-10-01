# LifeLens

LifeLens turns a notice into a plain-English summary and an evidence-backed action list. It includes a responsive, no-account web app, a local JavaScript parser, optional Gemini analysis, MongoDB persistence, and optional email and WhatsApp deadline reminders.

## Run locally

```sh
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). With no configuration, LifeLens uses its local parser and an in-memory development database. In-memory data is cleared when the server restarts.

## Configuration

Copy `.env.example` to `.env` and configure only the providers you want to use:

- `MONGODB_URI` and optional `MONGODB_DB` enable MongoDB Atlas persistence for notices, cached role-specific analyses, tasks, statuses, and reminder state. Without a URI, the app clearly logs that it is using in-memory storage.
- `USE_AI=true` with `GEMINI_API_KEY` enables Gemini analysis. The local parser runs when AI is disabled, the key is absent, or Gemini returns an error or invalid evidence.
- SMTP settings and `REMINDER_EMAIL` enable email reminders. Twilio account credentials, a WhatsApp sender, and `REMINDER_WHATSAPP_TO` enable WhatsApp reminders. Reminders are checked at startup and hourly for pending tasks due within 24 hours.

Keep `.env` private; it is ignored by git. Never put real credentials in `.env.example` or commit them.

## API

- `GET /api/health` — service health
- `POST /api/analyze` — JSON body `{ "text": "...", "role": "Student" }`; valid roles are Student, Employee, Parent, and Customer. Returns the summary, extracted actions and evidence, and pending tasks. Repeated text and role reuse the cached analysis.
- `PATCH /api/tasks/:id` — JSON body `{ "status": "done" }` or `{ "status": "pending" }`

Each action includes its exact supporting sentence from the original notice. Deadlines include a Google Calendar link in the web interface when a date can be identified.
