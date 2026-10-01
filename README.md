# LifeLens

LifeLens turns a notice into a plain-English summary and an evidence-backed action list. It includes a responsive web app, a local JavaScript parser, optional Gemini analysis, account-isolated MongoDB persistence, and optional email deadline reminders.

## Run locally

1. Install Node.js 18 or later.
2. Copy `.env.example` to `.env` (for example, `Copy-Item .env.example .env` in PowerShell). `.env` is ignored by Git.
3. Fill in the credentials for the services you want to use. MongoDB is optional for local development; with no `MONGODB_URI`, the app uses an in-memory database and loses users, sessions, notices, tasks, and reminder states when it stops.
4. Run `npm install`, then `npm start`, and open `http://localhost:3000`.

Create an account with your name, email, international phone number (including `+` and the country calling code; for example `+91 96820 43203`), and a password of at least eight characters. Spaces, parentheses, and hyphens are accepted and removed before the number is stored. Email is used to sign in and receive reminders. WhatsApp links use the saved number only to prefill a message; you review and send it yourself in WhatsApp. Email is not verified. Account passwords are scrypt-hashed; sessions use random HttpOnly cookies and expire after 30 days.

## Accounts and reminders

Registration enables email reminders by default. Email reminders go only to the account email; turn them off in Reminder preferences to withdraw consent. An analysis never sends an email automatically. Each pending task has an **Email me this reminder now** button for an immediate, user-requested email. The hourly scheduler separately sends one reminder for tasks due within the next 24 hours (including overdue tasks) when email reminders are enabled and SMTP is configured.

Email delivery uses SMTP credentials. Successful immediate requests are recorded separately from scheduled reminders and cannot be sent twice for the same task. Failed immediate requests are recorded and can be retried; missing provider configuration is reported with the required settings and is never counted as sent.

Tasks with parsed deadlines offer a Google Calendar template link and a downloadable `.ics` event. LifeLens does not silently access a Google account: follow the link/import the file and confirm adding the event in your calendar. Each task also offers a WhatsApp share link; LifeLens does not call Twilio or send WhatsApp messages—review the prefilled message and press **Send** in WhatsApp yourself.

## Configuration

- `MONGODB_URI` and optional `MONGODB_DB` enable persistent storage for accounts, hashed sessions, documents, cached analyses, tasks, and per-channel reminder state. Without the URI, the in-memory development database is used.
- `USE_AI=true` with `GEMINI_API_KEY` enables Gemini analysis for pasted/text notices and PDF/image uploads. Gemini is optional for text: the local parser is used when AI is disabled or the key is absent, and is the fallback when Gemini returns an error, malformed analysis, or evidence that is not an exact source sentence.
- Email requires `SMTP_HOST` and either `SMTP_FROM` or `SMTP_USER`; if `SMTP_USER` is set, `SMTP_PASS` is also required. `SMTP_PORT` defaults to 587 and `SMTP_SECURE` defaults to false.
- WhatsApp messages are shared manually through `wa.me`; Twilio settings and API delivery are not used.
- `PORT` is read from the environment; it defaults to 3000.

Never commit `.env`, paste credentials into the browser/client bundle, or store secrets in repository files. Configure production secrets using the deployment provider's secret/environment settings.

## MongoDB Atlas setup

1. Create a MongoDB Atlas account and a free cluster.
2. Create a database user and strong password. This is distinct from your Atlas website login.
3. Add your local public IP to the cluster's Network Access IP allowlist for development. For deployment, configure the deployed service's stable outbound IP(s) if available. Avoid opening database access to all IPs unless there is no safer provider-supported option and you understand the exposure.
4. Copy the application connection string from Atlas, replace its database-user placeholders, and set it as `MONGODB_URI`; set `MONGODB_DB=lifelens` if desired. URL-encode special characters in the database user's password before inserting them into the URI.
5. Keep the URI only in ignored local `.env` or the deployment host's secret manager/dashboard.

## Optional AI and email setup

- **Gemini:** Create a Google AI Studio account and API key if Gemini analysis is wanted. Set `USE_AI=true` and `GEMINI_API_KEY`; otherwise the local parser works without a key.
- **Upload a notice:** Upload PDF, PNG, JPG, WEBP, TXT, MD, CSV, or EML files up to 8 MB. Text files use the local parser or Gemini. PDF and image uploads are read by Gemini, so set `USE_AI=true` and `GEMINI_API_KEY`; without them, paste the notice text or upload a text file. When AI is enabled, uploaded document contents are sent to Gemini for analysis.
- **Email:** Create an account with an SMTP provider, verify the sender/domain, and configure `SMTP_HOST` plus `SMTP_FROM` (or `SMTP_USER`; with a user, also set `SMTP_PASS`). `SMTP_PORT`, `SMTP_SECURE`, and `SMTP_FROM` are optional only when their documented defaults/alternative apply. Delivery won't occur without SMTP.
- **Google Calendar:** No Google OAuth is configured. Use the task's Google Calendar template or download the `.ics` event and confirm the import yourself.
- **WhatsApp:** Each task's manual share link opens WhatsApp with a prefilled message. It is not automatically sent and does not require Twilio.

## Deploy

Choose a Node.js hosting provider such as Render, Railway, or Fly.io and create a web service from this repository. Use `npm start` as the start command and let the host assign `PORT`. Set `NODE_ENV=production`, `MONGODB_URI`, `MONGODB_DB`, and any optional Gemini/SMTP variables as secrets through the host dashboard; never place production secrets in GitHub files or the client bundle. Configure Atlas network access for the host's outbound IPs and keep the database restricted to the service where possible. The app serves `/api/health` as a health check; configure the host to use HTTPS so production session cookies use the `Secure` flag. Do not deploy publicly without persistent MongoDB, since in-memory accounts and data disappear on restart. A GitHub deploy key is not needed when the hosting provider is connected to the repository through its supported Git integration.

### What you need to collect

**Required for a persistent public deployment:** MongoDB Atlas account, cluster, database username/password, connection URI, and the hosting provider account/project. No GitHub deploy key is required.

**Optional:** Gemini API key (AI analysis); SMTP account credentials and a verified sender (email reminders). Google Calendar and WhatsApp links are user-confirmed/manual.

## API

- `GET /api/health` — service health
- `POST /api/auth/register` — create an account and sign in
- `POST /api/auth/login` — sign in with email and password
- `POST /api/auth/logout` — revoke the current session and clear its cookie
- `GET /api/auth/me` — return the signed-in account
- `GET /api/profile` and `PATCH /api/profile` — inspect/update reminder opt-ins
- `POST /api/analyze` — authenticated JSON body `{ "text": "...", "role": "Student" }`; valid roles are Student, Employee, Parent, and Customer. Returns summary, extracted actions/evidence, and tasks. Repeated text and role reuse that account's cached analysis.
- `POST /api/analyze-file` — authenticated JSON body `{ "name": "...", "mimeType": "...", "data": "<base64>", "role": "Student" }`; accepts PDF/images (Gemini required) and text files (local parser works without Gemini), up to 8 MB.
- `PATCH /api/tasks/:id` — authenticated JSON body `{ "status": "done" }` or `{ "status": "pending" }`; only the task owner can update it.
- `POST /api/tasks/:id/remind-email` — immediately send one reminder to the authenticated task owner's account email, only for pending tasks with email consent and SMTP configured. A successful send is deduplicated per task.
- `GET /api/tasks/:id/calendar.ics` — download an all-day calendar event for an owned task with a valid deadline.

Each action includes exact supporting sentences from the source notice. Dates in a notice heading alone do not create event details; the parser only extracts explicit actions and retains the source sentence as evidence.

The home page includes a gated sample plan for quick demos; sign in or create an account and the sample notice is loaded automatically. Its evidence-first action list and task-specific email, calendar, and editable WhatsApp tools are intended to make the next step actionable without claiming that any external message or calendar event was added before user confirmation.

## Tests

Run `npm test` for the built-in Node test suite, including memory-database authentication, access-control, and account-isolation checks.
