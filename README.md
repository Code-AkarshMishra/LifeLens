# LifeLens

LifeLens turns a notice into a plain-English summary and an evidence-backed action list. It includes a responsive web app, a local JavaScript parser, optional Gemini analysis, account-isolated MongoDB persistence, and optional email deadline reminders.

## Run locally

1. Install Node.js 18 or later.
2. Copy `.env.example` to `.env` (for example, `Copy-Item .env.example .env` in PowerShell). `.env` is ignored by Git.
3. Fill in the credentials for the services you want to use. MongoDB is optional for local development; with no `MONGODB_URI`, the app uses an in-memory database and loses users, sessions, notices, tasks, and reminder states when it stops.
4. Run `npm install`, then `npm start`, and open `http://localhost:3000`.

Create an account with your name, email, international phone number (including `+` and the country calling code; for example `+91 96820 43203`), and a password of at least eight characters. Spaces, parentheses, and hyphens are accepted and removed before the number is stored. Email is used to sign in and receive reminders. Phone is saved for future WhatsApp support, which is currently paused. Email is not verified. Account passwords are scrypt-hashed; sessions use random HttpOnly cookies and expire after 30 days.

## Accounts and reminders

Registration enables email reminders by default. Email reminders go only to the account email; turn them off in Reminder preferences to withdraw consent. SMS verification and WhatsApp reminders have been removed for now and are unavailable in this version.

Email delivery uses SMTP credentials. SMTP failures are recorded per task and retried on the next hourly scheduler cycle; missing provider configuration is recorded as not configured and is not counted as sent.

## Configuration

- `MONGODB_URI` and optional `MONGODB_DB` enable persistent storage for accounts, hashed sessions, documents, cached analyses, tasks, and per-channel reminder state. Without the URI, the in-memory development database is used.
- `USE_AI=true` with `GEMINI_API_KEY` enables Gemini analysis. Gemini is optional; the local parser remains the fallback when AI is disabled, the key is absent, or AI returns an error or invalid evidence.
- SMTP settings enable opted-in email reminders to each user's saved email.
- SMS verification and WhatsApp reminders are temporarily disabled; Twilio settings are not needed.
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
- **Email:** Create an account with an SMTP provider, verify the sender/domain, and obtain the SMTP host, port, TLS setting, username, and password or app password. Set these as `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM`. This is optional; reminder delivery won't occur without it.
- SMS and WhatsApp reminders are paused and do not need Twilio configuration in this version.

## Deploy

Choose a Node.js hosting provider such as Render, Railway, or Fly.io and create a web service from this repository. Use `npm start` as the start command and let the host assign `PORT`. Set `NODE_ENV=production`, `MONGODB_URI`, `MONGODB_DB`, and any optional Gemini/SMTP variables as secrets through the host dashboard; never place production secrets in GitHub files or the client bundle. Configure Atlas network access for the host's outbound IPs and keep the database restricted to the service where possible. The app serves `/api/health` as a health check; configure the host to use HTTPS so production session cookies use the `Secure` flag. Do not deploy publicly without persistent MongoDB, since in-memory accounts and data disappear on restart. A GitHub deploy key is not needed when the hosting provider is connected to the repository through its supported Git integration.

### What you need to collect

**Required for a persistent public deployment:** MongoDB Atlas account, cluster, database username/password, connection URI, and the hosting provider account/project. No GitHub deploy key is required.

**Optional:** Gemini API key (AI analysis); SMTP account credentials and a verified sender (email reminders). SMS and WhatsApp are paused for now.

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

Each action includes exact supporting sentences from the source notice. Deadlines include a Google Calendar link in the web interface when a date can be identified.

## Tests

Run `npm test` for the built-in Node test suite, including memory-database authentication, access-control, and account-isolation checks.
