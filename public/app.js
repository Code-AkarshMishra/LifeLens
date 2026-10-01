const noticeInput = document.querySelector("#notice");
const roleSelect = document.querySelector("#role");
const analyzeButton = document.querySelector("#analyze-button");
const results = document.querySelector("#results");
const charCount = document.querySelector("#char-count");
const authPanel = document.querySelector("#auth-panel");
const authForm = document.querySelector("#auth-form");
const authModeButton = document.querySelector("#auth-mode");
const authError = document.querySelector("#auth-error");
const nameField = document.querySelector("#name-field");
const phoneField = document.querySelector("#phone-field");
let registering = false;
let currentUser = null;

const demoNotice = `Subject: Action required — Student registration

Please complete your course registration by October 15, 2026. Submit your signed course selection form to the Registrar's Office before the deadline.

Students who do not register by the deadline may be charged a late fee and could lose their place in selected courses. Contact the Registrar's Office if you need help.`;

noticeInput.addEventListener("input", () => {
  charCount.textContent = `${noticeInput.value.length.toLocaleString()} / 50,000`;
});

document.querySelector("#demo-button").addEventListener("click", () => {
  noticeInput.value = demoNotice;
  charCount.textContent = `${demoNotice.length} / 50,000`;
  noticeInput.focus();
});

analyzeButton.addEventListener("click", runAnalysis);

function setAuthMode(isRegistering) {
  registering = isRegistering;
  document.querySelector("#auth-title").textContent = registering ? "Create your account" : "Welcome back";
  document.querySelector("#auth-description").textContent = registering
    ? "Your email and phone are used for reminders. Choose a password to protect your account."
    : "Sign in to keep your action plans private to your account.";
  authModeButton.textContent = registering ? "I already have an account" : "Create account";
  document.querySelector("#auth-submit span").textContent = registering ? "Create account" : "Sign in";
  nameField.hidden = !registering;
  phoneField.hidden = !registering;
  nameField.querySelector("input").required = registering;
  phoneField.querySelector("input").required = registering;
  authForm.elements.password.autocomplete = registering ? "new-password" : "current-password";
}

authModeButton.addEventListener("click", () => {
  authError.hidden = true;
  authForm.reset();
  setAuthMode(!registering);
});

function showAuthenticated(user) {
  currentUser = user;
  authPanel.hidden = true;
  document.querySelector("#account-panel").hidden = false;
  document.querySelector("#analyzer-panel").hidden = false;
  document.querySelector("#account-name").textContent = `Hi, ${user.name}`;
  document.querySelector("#account-destinations").textContent = `${user.email} · ${user.phone}`;
  document.querySelector("#email-reminders").checked = user.emailReminders;
  document.querySelector("#whatsapp-reminders").checked = user.whatsappReminders;
  document.querySelector("#whatsapp-reminders").disabled = !user.phoneVerified && !user.whatsappReminders;
  const phoneStatus = document.querySelector("#phone-verification-status");
  phoneStatus.textContent = user.phoneVerified ? "Phone number verified." : "Phone number is not verified.";
  document.querySelector("#send-code-form").hidden = user.phoneVerified;
  document.querySelector("#verify-code-form").hidden = user.phoneVerified;
}

function showSignedOut() {
  currentUser = null;
  authPanel.hidden = false;
  document.querySelector("#account-panel").hidden = true;
  document.querySelector("#analyzer-panel").hidden = true;
  results.hidden = true;
  results.replaceChildren();
  noticeInput.value = "";
  charCount.textContent = "0 / 50,000";
  document.querySelector("#account-name").textContent = "";
  document.querySelector("#account-destinations").textContent = "";
}

async function restoreSession() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) return showSignedOut();
    const { user } = await response.json();
    showAuthenticated(user);
  } catch {
    showSignedOut();
  }
}

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  authError.hidden = true;
  const form = new FormData(authForm);
  const payload = {
    email: form.get("email"),
    password: form.get("password")
  };
  if (registering) {
    payload.name = form.get("name");
    payload.phone = form.get("phone");
  }
  const button = document.querySelector("#auth-submit");
  button.disabled = true;
  try {
    const response = await fetch(registering ? "/api/auth/register" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not sign in.");
    authForm.reset();
    showAuthenticated(result.user);
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#logout-button").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Could not sign out. Please try again.");
    showSignedOut();
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
    authPanel.hidden = false;
  }
});

document.querySelector("#preferences-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#preferences-status");
  status.textContent = "Saving…";
  try {
    const response = await fetch("/api/profile", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        emailReminders: document.querySelector("#email-reminders").checked,
        whatsappReminders: document.querySelector("#whatsapp-reminders").checked
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save preferences.");
    currentUser = { ...currentUser, ...result.user };
    document.querySelector("#whatsapp-reminders").checked = result.user.whatsappReminders;
    status.textContent = "Reminder preferences saved.";
  } catch (error) {
    status.textContent = error.message;
  }
});

document.querySelector("#send-code-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#phone-verification-status");
  const button = document.querySelector("#send-code-button");
  if (!document.querySelector("#sms-consent").checked) {
    status.textContent = "Agree to the one-time SMS before requesting a code.";
    return;
  }
  button.disabled = true;
  status.textContent = "Requesting code…";
  try {
    const response = await fetch("/api/profile/phone-verification/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ smsConsent: true })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not send a verification code.");
    status.textContent = result.message;
    document.querySelector("#sms-consent").checked = false;
    document.querySelector("#verify-code-form").hidden = false;
    document.querySelector("#verification-code").focus();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

document.querySelector("#verify-code-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = document.querySelector("#phone-verification-status");
  const button = document.querySelector("#verify-code-button");
  button.disabled = true;
  status.textContent = "Checking code…";
  try {
    const response = await fetch("/api/profile/phone-verification/verify-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: document.querySelector("#verification-code").value.trim() })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not verify this phone number.");
    document.querySelector("#verification-code").value = "";
    showAuthenticated({ ...currentUser, ...result.user });
    status.textContent = "Phone number verified. You can now separately opt in to WhatsApp reminders.";
  } catch (error) {
    status.textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function calendarUrl(action) {
  if (!action.deadline) return "";
  const start = action.deadline.replaceAll("-", "");
  const endDate = new Date(`${action.deadline}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const end = endDate.toISOString().slice(0, 10).replaceAll("-", "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: action.action,
    dates: `${start}/${end}`,
    details: `From your notice: "${action.evidence}"`
  });
  return `https://calendar.google.com/calendar/render?${params}`;
}

function renderResult(result) {
  const actions = result.analysis?.actions || [];
  const tasks = result.tasks || [];
  const taskByEvidence = new Map(tasks.map((task) => [task.evidence, task]));
  results.innerHTML = `<div class="result-kicker">Your action plan${result.cached ? " · saved analysis" : ""}</div>
    <p class="summary">${escapeHtml(result.analysis?.summary || "Review the notice details below.")}</p>
    <p class="reminder-note">Email reminders use your saved email. WhatsApp reminders require a verified phone and separate opt-in; enabled reminders are checked hourly for due tasks.</p>
    <h2 class="actions-title">What to do <small>${actions.length} ${actions.length === 1 ? "action" : "actions"}</small></h2>
    ${actions.length ? actions.map((action) => {
      const task = taskByEvidence.get(action.evidence);
      const link = calendarUrl(action);
      const reminderLabel = (channel) => {
        if (!currentUser?.[`${channel}Reminders`]) return "Off in preferences";
        if (channel === "whatsapp" && !currentUser.phoneVerified) return "Paused: phone not verified";
        const state = task?.reminders?.[channel];
        if (state?.status === "sent") return "Sent";
        if (state?.status === "not_configured") return "Not sent: provider not configured";
        if (state?.status === "error") return "Not sent: will retry";
        if (state?.status === "phone_unverified") return "Paused: phone not verified";
        return "Enabled; waiting for deadline";
      };
      return `<article class="task-card">
        <div class="task-main">
          <input class="task-toggle" type="checkbox" aria-label="Mark task done" data-task="${escapeHtml(task?.id || "")}" ${task?.status === "done" ? "checked" : ""} ${task?.id ? "" : "disabled"}>
          <div class="task-copy ${task?.status === "done" ? "done" : ""}">${escapeHtml(action.action)}</div>
          <span class="priority ${action.priority === "High" ? "high" : ""}">${escapeHtml(action.priority || "Normal")} priority</span>
        </div>
        <div class="task-meta">${action.deadline ? `<strong>Deadline:</strong> ${escapeHtml(action.deadlineText || action.deadline)} · ${escapeHtml(action.deadline)}` : "<strong>Deadline:</strong> Not specified"}<br><strong>If missed:</strong> ${escapeHtml(action.consequence)}</div>
        <div class="task-meta reminder-status"><strong>Reminders:</strong> Email — ${escapeHtml(reminderLabel("email"))} · WhatsApp — ${escapeHtml(reminderLabel("whatsapp"))}</div>
        <blockquote class="evidence"><span class="evidence-label">Exact evidence from your notice</span>“${escapeHtml(action.evidence)}”</blockquote>
        ${action.consequenceEvidence && action.consequenceEvidence !== action.evidence ? `<blockquote class="evidence"><span class="evidence-label">Consequence evidence from your notice</span>“${escapeHtml(action.consequenceEvidence)}”</blockquote>` : ""}
        ${link ? `<a class="calendar-link" href="${link}" target="_blank" rel="noopener noreferrer">Add deadline to Google Calendar ↗</a>` : ""}
      </article>`;
    }).join("") : `<p class="empty-state">No clear action could be extracted automatically. Read through your notice and look for requests, dates, and required next steps. Nothing has been inferred as a task.</p>`}`;
  results.hidden = false;
  results.querySelectorAll(".task-toggle").forEach((checkbox) => {
    checkbox.addEventListener("change", () => updateTask(checkbox, result));
  });
}

async function updateTask(checkbox, result) {
  const taskId = checkbox.dataset.task;
  checkbox.disabled = true;
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: checkbox.checked ? "done" : "pending" })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not update task.");
    const task = result.tasks.find((item) => item.id === taskId);
    if (task) task.status = data.task.status;
    checkbox.nextElementSibling.classList.toggle("done", checkbox.checked);
  } catch (error) {
    checkbox.checked = !checkbox.checked;
    showError(error.message);
  } finally {
    checkbox.disabled = false;
  }
}

function showError(message) {
  const error = document.querySelector("#analysis-error");
  error.textContent = message;
  error.hidden = false;
}

async function runAnalysis() {
  const text = noticeInput.value.trim();
  if (!text) {
    noticeInput.focus();
    showError("Paste a notice or try the demo notice first.");
    return;
  }

  setAuthMode(false);
  restoreSession();
  document.querySelector("#analysis-error").hidden = true;
  analyzeButton.disabled = true;
  analyzeButton.querySelector("span").textContent = "Reading your notice…";
  results.hidden = true;
  try {
    const response = await fetch("/api/analyze", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, role: roleSelect.value })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not analyze this notice.");
    renderResult(result);
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error.message);
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.querySelector("span").textContent = "Find my next steps";
  }
}
