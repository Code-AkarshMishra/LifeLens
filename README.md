# LifeLens

LifeLens turns a notice into a plain-English summary and an evidence-backed action list. It includes a responsive web app, a local JavaScript parser, optional Gemini analysis, account-isolated MongoDB persistence, and optional email and WhatsApp deadline reminders.

## Run locally

1. Install Node.js 18 or later.
2. Copy `.env.example` to `.env` (for example, `Copy-Item .env.example .env` in PowerShell). `.env` is ignored by Git.
3. Fill in the credentials for the services you want to use. MongoDB is optional for local development; with no `MONGODB_URI`, the app uses an in-memory database and loses users, sessions, notices, tasks, and reminder states when it stops.
4. Run `npm install`, then `npm start`, and open `http://localhost:3000`.

Create an account with your name, email, E.164 phone number (for example `+14155552671`), and a password of at least eight characters. Email and phone are reminder destinations, not sign-in identifiers (email is used to sign in). Email is not verified. Account passwords are scrypt-hashed; sessions use random HttpOnly cookies and expire after 30 days.

## Accounts and reminders

Registration enables email reminders by default and leaves WhatsApp reminders off. Update or withdraw either consent in Reminder preferences. Email reminders go only to the account email. To enable WhatsApp, first request a one-time SMS code in account settings and enter the code Twilio Verify sends to the saved phone. Sending that OTP requires separate explicit consent in the phone-verification panel; it does not opt in to WhatsApp reminders. Code requests are limited to one request per phone number per 60 seconds (also covering repeated requests by the same account), in addition to Twilio's limits. WhatsApp remains independently opted out until the user enables it after verification.

Email reminders are sent for pending tasks due by the next day when SMTP is configured. Supply SMTP host, port, TLS mode, sender (`SMTP_FROM` or `SMTP_USER`), and credentials (`SMTP_USER`/`SMTP_PASS` if required). Use a provider-approved sender; for consumer providers, an app password may be required.

Phone verification uses a Twilio Verify Service and SMS; it requires account SID, Auth Token, and Verify Service SID. The app marks a phone verified only when Twilio Verify returns `approved`. Twilio Verify failures and missing configuration are surfaced to the user without marking the phone verified.

WhatsApp delivery uses Twilio credentials and an approved WhatsApp sender (`TWILIO_WHATSAPP_FROM`). Twilio's sandbox requires the recipient to opt in to the sandbox first. Production sending may require an approved sender and message templates, particularly outside the customer-service conversation window or depending on recipient country. Twilio will not be called for a phone that the app considers unverified. SMTP/Twilio failures are recorded per task and channel and retried on the next hourly scheduler cycle; missing provider configuration is recorded as not configured and is not counted as sent.

## Configuration

- `MONGODB_URI` and optional `MONGODB_DB` enable persistent storage for accounts, hashed sessions, documents, cached analyses, tasks, and per-channel reminder state. Without the URI, the in-memory development database is used.
- `USE_AI=true` with `GEMINI_API_KEY` enables Gemini analysis. Gemini is optional; the local parser remains the fallback when AI is disabled, the key is absent, or AI returns an error or invalid evidence.
- SMTP settings enable opted-in email reminders to each user's saved email.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` enable SMS phone verification. In account settings, the user must separately consent to a one-time verification SMS and enter its code. This consent does not enable WhatsApp reminders.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_VERIFY_SERVICE_SID` enable SMS phone verification. In account settings, the user must separately consent to a one-time verification SMS and enter its code. This consent does not enable WhatsApp reminders.
- `PORT` is read from the environment; it defaults to 3000.

Never commit `.env`, paste credentials into the browser/client bundle, or store secrets in repository files. Configure production secrets using the deployment provider's secret/environment settings.

## MongoDB Atlas setup

1. Create a MongoDB Atlas account and a free cluster.
2. Create a database user and strong password. This is distinct from your Atlas website login.
3. Add your local public IP to the cluster's Network Access IP allowlist for development. For deployment, configure the deployed service's stable outbound IP(s) if available. Avoid opening database access to all IPs unless there is no safer provider-supported option and you understand the exposure.
4. Copy the application connection string from Atlas, replace its database-user placeholders, and set it as `MONGODB_URI`; set `MONGODB_DB=lifelens` if desired. URL-encode special characters in the database user's password before inserting them into the URI.
5. Keep the URI only in ignored local `.env` or the deployment host's secret manager/dashboard.

## Optional AI and messaging accounts

- **Gemini:** Create a Google AI Studio account and API key if Gemini analysis is wanted. Set `USE_AI=true` and `GEMINI_API_KEY`; otherwise the local parser works without a key.
- **Email:** Create an account with an SMTP provider, verify the sender/domain, and obtain the SMTP host, port, TLS setting, username, and password or app password. Set these as `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and optionally `SMTP_FROM`. This is optional; reminder delivery won't occur without it.
- **SMS verification and WhatsApp:** Create a Twilio account and obtain Account SID and Auth Token. Create a Verify Service in the Twilio console and set its Service SID as `TWILIO_VERIFY_SERVICE_SID`. SMS verification codes are sent through that service after each user separately consents in account settings; sends are rate-limited by the app to one per user per 60 seconds, with Twilio applying additional limits. To deliver WhatsApp reminders, also configure an approved WhatsApp sender as `TWILIO_WHATSAPP_FROM`. For testing, use Twilio's WhatsApp Sandbox and have each recipient complete the sandbox opt-in. Users must verify their phone by SMS and separately opt in to WhatsApp reminders; neither consent implies the other.

## Deploy

Choose a Node.js hosting provider such as Render, Railway, or Fly.io and create a web service from this repository. Use `npm start` as the start command and let the host assign `PORT`. Set `NODE_ENV=production`, `MONGODB_URI`, `MONGODB_DB`, and any optional Gemini/SMTP/Twilio variables as secrets through the host dashboard; never place production secrets in GitHub files or the client bundle. Configure Atlas network access for the host's outbound IPs and keep the database restricted to the service where possible. The app serves `/api/health` as a health check; configure the host to use HTTPS so production session cookies use the `Secure` flag. Do not deploy publicly without persistent MongoDB, since in-memory accounts and data disappear on restart. A GitHub deploy key is not needed when the hosting provider is connected to the repository through its supported Git integration.

### What you need to collect

**Required for a persistent public deployment:** MongoDB Atlas account, cluster, database username/password, connection URI, and the hosting provider account/project. No GitHub deploy key is required.

**Optional:** Gemini API key (AI analysis); SMTP account credentials and a verified sender (email reminders); Twilio account SID/Auth Token and Verify Service SID (consensual SMS phone verification); approved Twilio WhatsApp sender plus recipients' sandbox opt-in or applicable production approval (WhatsApp reminders).

## API

- `GET /api/health` — service health
- `POST /api/auth/register` — create an account and sign in
- `POST /api/auth/login` — sign in with email and password
- `POST /api/auth/logout` — revoke the current session and clear its cookie
- `GET /api/auth/me` — return the signed-in account
- `GET /api/profile` and `PATCH /api/profile` — inspect/update reminder opt-ins
- `POST /api/profile/phone-verification/send-code` — request a Twilio Verify SMS after explicit SMS consent (60-second per-phone rate limit)
- `POST /api/profile/phone-verification/verify-code` — check the submitted code; phone is marked verified only for Twilio status `approved`
- `POST /api/analyze` — authenticated JSON body `{ "text": "...", "role": "Student" }`; valid roles are Student, Employee, Parent, and Customer. Returns summary, extracted actions/evidence, and tasks. Repeated text and role reuse that account's cached analysis.
- `PATCH /api/tasks/:id` — authenticated JSON body `{ "status": "done" }` or `{ "status": "pending" }`; only the task owner can update it.

Each action includes exact supporting sentences from the source notice. Deadlines include a Google Calendar link in the web interface when a date can be identified.

## Tests

Run `npm test` for the built-in Node test suite, including memory-database authentication, access-control, and account-isolation checks.
