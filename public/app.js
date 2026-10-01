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
const fileInput = document.querySelector("#notice-file");
const fileName = document.querySelector("#file-name");
let selectedFile = null;
let registering = false;
let currentUser = null;
let pendingDemo = false;

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
    document.querySelector("#analyzer-panel").scrollIntoView({ behavior: "smooth", block: "center" });
  } catch (error) {
    authError.textContent = error.message;
    authError.hidden = false;
  } finally {
    button.disabled = false;
  }
});

setAuthMode(false);

function reminderLinks() {
  const links = window.LifeLensReminderLinks;
  if (!links) throw new Error("Reminder tools failed to load. Reload the page and try again.");
  return links;
}

function calendarUrl(action) {
  return reminderLinks().calendarUrl(action);
}

function whatsappUrl(task, user, customMessage) {
  return reminderLinks().whatsappUrl(task, user, customMessage);
}

const demoNotice = `Subject: Action required — Student registration

Please complete your course registration by October 15, 2026. Submit your signed course selection form to the Registrar's Office before the deadline.

Students who do not register by the deadline may be charged a late fee and could lose their place in selected courses. Contact the Registrar's Office if you need help.`;

noticeInput.addEventListener("input", () => {
  selectedFile = null;
  fileInput.value = "";
  document.querySelector("#clear-file").hidden = true;
  fileName.textContent = "PDF, image, or text file · max 8 MB";
  charCount.textContent = `${noticeInput.value.length.toLocaleString()} / 50,000`;
});

document.querySelector("#demo-button").addEventListener("click", () => {
  fillDemoNotice();
});

function fillDemoNotice() {
  selectedFile = null;
  fileInput.value = "";
  document.querySelector("#clear-file").hidden = true;
  fileName.textContent = "PDF, image, or text file · max 8 MB";
  noticeInput.value = demoNotice;
  charCount.textContent = `${demoNotice.length} / 50,000`;
  document.querySelector("#analysis-error").hidden = true;
  noticeInput.focus();
}

document.querySelector("#home-demo-button").addEventListener("click", () => {
  if (currentUser) {
    fillDemoNotice();
    document.querySelector("#analyzer-panel").scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  pendingDemo = true;
  authError.textContent = "Sign in or create an account; the sample notice will be ready when you are.";
  authError.hidden = false;
  authPanel.scrollIntoView({ behavior: "smooth", block: "center" });
});

fileInput.addEventListener("change", async () => {
  const file = fileInput.files[0];
  if (!file) return;
  selectedFile = null;
  document.querySelector("#clear-file").hidden = true;
  document.querySelector("#analysis-error").hidden = true;
  if (file.size > 8 * 1024 * 1024) {
    fileInput.value = "";
    selectedFile = null;
    showError("Files must be 8 MB or smaller.");
    return;
  }
  const extension = file.name.split(".").pop().toLowerCase();
  if (["txt", "md", "csv", "eml"].includes(extension) || file.type.startsWith("text/") || file.type === "message/rfc822") {
    try {
      const text = await file.text();
      if (!text.trim()) throw new Error("This file is empty.");
      if (text.length > 50000) throw new Error("Text notices must be 50,000 characters or fewer.");
      selectedFile = null;
      noticeInput.value = text;
      charCount.textContent = `${text.length.toLocaleString()} / 50,000`;
      fileName.textContent = `${file.name} loaded`;
      document.querySelector("#clear-file").hidden = false;
      noticeInput.focus();
    } catch (error) {
      fileInput.value = "";
      showError(error.message);
    }
    return;
  }
  selectedFile = file;
  noticeInput.value = "";
  charCount.textContent = "0 / 50,000";
  fileName.textContent = `${file.name} · ready to analyze`;
  document.querySelector("#clear-file").hidden = false;
  results.hidden = true;
});

document.querySelector("#clear-file").addEventListener("click", () => {
  selectedFile = null;
  fileInput.value = "";
  noticeInput.value = "";
  charCount.textContent = "0 / 50,000";
  fileName.textContent = "PDF, image, or text file · max 8 MB";
  document.querySelector("#clear-file").hidden = true;
});

analyzeButton.addEventListener("click", runAnalysis);

function setAuthMode(isRegistering) {
  registering = isRegistering;
  document.querySelector("#auth-title").textContent = registering ? "Create your account" : "Welcome back";
  document.querySelector("#auth-description").textContent = registering
    ? "Your email receives reminders. Your international phone number is used only to prepare optional WhatsApp messages for you to send."
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
  authError.hidden = true;
  authPanel.hidden = true;
  document.querySelector("#account-panel").hidden = false;
  document.querySelector("#analyzer-panel").hidden = false;
  document.querySelector("#account-name").textContent = `Hi, ${user.name}`;
  document.querySelector("#account-destinations").textContent = `${user.email} · ${user.phone}`;
  document.querySelector("#email-reminders").checked = user.emailReminders;
  if (pendingDemo) {
    pendingDemo = false;
    fillDemoNotice();
  }
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
        emailReminders: document.querySelector("#email-reminders").checked
      })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not save preferences.");
    currentUser = { ...currentUser, ...result.user };
    status.textContent = "Reminder preferences saved.";
  } catch (error) {
    status.textContent = error.message;
  }
});

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function renderResult(result) {
  const actions = result.analysis?.actions || [];
  const tasks = result.tasks || [];
  const taskByEvidence = new Map(tasks.map((task) => [task.evidence, task]));
  const completed = tasks.filter((task) => task.status === "done").length;
  const remaining = tasks.length - completed;
  const nextTask = tasks.find((task) => task.status !== "done");
  const progressTitle = tasks.length ? (remaining ? `${remaining} ${remaining === 1 ? "step" : "steps"} left` : "All steps complete") : "No tasks found";
  const progressText = !tasks.length
    ? "Try another notice or include a clear request or deadline."
    : (remaining
      ? `Next up: ${nextTask.action}`
      : "Nice work. Your action plan is complete.");
  results.innerHTML = `<div class="result-kicker">Your action plan${result.sourceName ? ` · ${escapeHtml(result.sourceName)}` : ""}${result.cached ? " · saved analysis" : ""}</div>
    <p class="summary">${escapeHtml(result.analysis?.summary || "Review the notice details below.")}</p>
    <div class="plan-progress" role="status" aria-live="polite">
      <div class="progress-heading"><strong>${escapeHtml(progressTitle)}</strong><span class="progress-count">${completed} / ${tasks.length} done</span></div>
      <div class="progress-track"><span class="progress-fill" style="width:${tasks.length ? Math.round(completed / tasks.length * 100) : 0}%"></span></div>
      <p class="progress-message">${escapeHtml(progressText)}</p>
      <button class="text-button next-notice-button" type="button" ${remaining || !tasks.length ? "hidden" : ""}>Analyze another notice ↑</button>
    </div>
    <p class="reminder-note">Review and edit each email before choosing Send email now (SMTP required). Calendar files and WhatsApp messages are prepared for you to review and add/send yourself.</p>
    <h2 class="actions-title">What to do <small>${actions.length} ${actions.length === 1 ? "action" : "actions"}</small></h2>
    ${actions.length ? actions.map((action) => {
      const task = taskByEvidence.get(action.evidence);
      const link = calendarUrl(action);
      const calendarDownload = task?.id && link
        ? `/api/tasks/${encodeURIComponent(task.id)}/calendar.ics`
        : "";
      const whatsappTask = task ? { ...task, ...action } : null;
      const whatsapp = whatsappTask ? whatsappUrl(whatsappTask, currentUser) : "";
      const immediateEmail = task?.reminders?.emailImmediate;
      const emailSubject = `LifeLens reminder: ${action.action}`.slice(0, 200);
      const actionMatchesEvidence = action.action === action.evidence;
      const separateConsequenceEvidence = action.consequenceEvidence
        && action.consequenceEvidence !== action.evidence
        && action.consequenceEvidence !== action.action;
      const emailText = [
        `${actionMatchesEvidence ? "Action (exact sentence from your notice)" : "Action"}: ${action.action}`,
        `Deadline: ${action.deadline ? `${action.deadlineText || action.deadline} (${action.deadline})` : "No deadline specified in the notice"}`,
        `Priority: ${action.priority || "Normal"}`,
        `${separateConsequenceEvidence ? "If missed (exact related sentence from your notice)" : "If missed"}: ${separateConsequenceEvidence ? action.consequenceEvidence : (action.consequence || "No consequence is explicitly stated in this notice.")}`,
        ...(!actionMatchesEvidence ? ["", "Exact sentence from your notice:", action.evidence] : [])
      ].join("\n");
      const reminderLabel = (channel) => {
        if (!currentUser?.[`${channel}Reminders`]) return "Off in preferences";
        const state = task?.reminders?.[channel];
        if (state?.status === "sent") return channel === "email" ? "Submitted to SMTP" : "Sent";
        if (state?.status === "not_configured") return "Not sent: provider not configured";
        if (state?.status === "error") return "Not sent: will retry";
        if (state?.status === "phone_unverified") return "Paused: phone not verified";
        return "Enabled; waiting for deadline";
      };
      return `<article class="task-card ${task?.status === "done" ? "is-done" : ""}">
        <div class="task-main">
          <input class="task-toggle" type="checkbox" aria-label="Mark task done" data-task="${escapeHtml(task?.id || "")}" ${task?.status === "done" ? "checked" : ""} ${task?.id ? "" : "disabled"}>
          <div class="task-copy ${task?.status === "done" ? "done" : ""}">${escapeHtml(action.action)}</div>
          <span class="priority ${action.priority === "High" ? "high" : ""}">${escapeHtml(action.priority || "Normal")} priority</span>
        </div>
        <div class="task-meta">${action.deadline ? `<strong>Deadline:</strong> ${escapeHtml(action.deadlineText || action.deadline)} · ${escapeHtml(action.deadline)}` : "<strong>Deadline:</strong> Not specified"}<br><strong>If missed:</strong> ${escapeHtml(action.consequence)}</div>
        <div class="task-meta reminder-status"><strong>Scheduled email:</strong> ${escapeHtml(reminderLabel("email"))}</div>
        <div class="task-tools">
          <button class="task-action-button email-now-button" type="button" aria-expanded="false" ${!task?.id || task.status === "done" || !currentUser?.emailReminders || immediateEmail?.status === "sending" || immediateEmail?.sentAt ? "disabled" : ""}>${immediateEmail?.sentAt ? "Email submitted to SMTP" : "Send email now"}</button>
          ${link ? `<a class="task-action-button secondary" href="${link}" target="_blank" rel="noopener noreferrer">Open Google Calendar ↗</a>` : ""}
          ${calendarDownload ? `<a class="task-action-button secondary" href="${escapeHtml(calendarDownload)}">Download .ics</a>` : ""}
        </div>
        <form class="email-composer" data-email-task="${escapeHtml(task?.id || "")}" hidden>
          <label>Subject<input class="email-subject" type="text" maxlength="200" required value="${escapeHtml(emailSubject)}"></label>
          <label>Message<textarea class="email-message" maxlength="100000" required>${escapeHtml(emailText)}</textarea></label>
          <p class="manual-share-note">Review and edit the message before sending. It will go only to ${escapeHtml(currentUser?.email || "your account email")}.</p>
          <button class="task-action-button email-submit-button" type="submit" ${!task?.id || task.status === "done" || !currentUser?.emailReminders ? "disabled" : ""}>Send email now</button>
        </form>
        ${whatsappTask ? `<details class="whatsapp-composer">
          <summary>Compose WhatsApp message</summary>
          <label>Customize before opening<textarea class="whatsapp-message" data-whatsapp-task="${escapeHtml(task.id)}">${escapeHtml(reminderLinks().whatsappMessage(whatsappTask))}</textarea></label>
          <a class="task-action-button whatsapp whatsapp-open" href="${escapeHtml(whatsapp)}" target="_blank" rel="noopener noreferrer">Open WhatsApp ↗</a>
          <p class="manual-share-note">Review the message in WhatsApp and press Send yourself. LifeLens does not send WhatsApp messages.</p>
        </details>` : ""}
        <p class="task-action-status" data-email-status="${escapeHtml(task?.id || "")}" role="status">${immediateEmail?.sentAt ? `SMTP accepted the email for delivery to ${escapeHtml(currentUser.email)}.` : (!currentUser?.emailReminders ? "Turn on email reminders in preferences to send." : "")}</p>
        <details class="evidence-details"><summary>Why this is on your list</summary><blockquote class="evidence"><span class="evidence-label">Exact sentence from your notice</span>“${escapeHtml(action.evidence)}”</blockquote>
        ${action.consequenceEvidence && action.consequenceEvidence !== action.evidence ? `<blockquote class="evidence"><span class="evidence-label">Related consequence</span>“${escapeHtml(action.consequenceEvidence)}”</blockquote>` : ""}</details>
      </article>`;
    }).join("") : `<p class="empty-state">No clear action could be extracted automatically. Read through your notice and look for requests, dates, and required next steps. Nothing has been inferred as a task.</p>`}`;
  results.hidden = false;
  results.querySelector(".next-notice-button").addEventListener("click", () => {
    noticeInput.scrollIntoView({ behavior: "smooth", block: "center" });
    noticeInput.focus({ preventScroll: true });
  });
  results.querySelectorAll(".task-toggle").forEach((checkbox) => {
    checkbox.addEventListener("change", () => updateTask(checkbox, result));
  });
  results.querySelectorAll(".email-now-button").forEach((button) => {
    button.addEventListener("click", () => {
      const composer = button.closest(".task-card").querySelector(".email-composer");
      const isOpen = !composer.hidden;
      composer.hidden = isOpen;
      button.setAttribute("aria-expanded", String(!isOpen));
      if (!isOpen) composer.querySelector(".email-subject").focus();
    });
  });
  results.querySelectorAll(".email-composer").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      sendTaskEmail(form, result);
    });
  });
  results.querySelectorAll(".whatsapp-message").forEach((textarea) => {
    textarea.addEventListener("input", () => {
      const task = result.tasks.find((item) => item.id === textarea.dataset.whatsappTask);
      if (!task) return;
      const link = textarea.closest(".whatsapp-composer").querySelector(".whatsapp-open");
      link.href = whatsappUrl(task, currentUser, textarea.value);
    });
  });
}

async function sendTaskEmail(form, result) {
  const taskId = form.dataset.emailTask;
  const status = results.querySelector(`[data-email-status="${CSS.escape(taskId)}"]`);
  const button = form.querySelector(".email-submit-button");
  button.disabled = true;
  button.textContent = "Sending email…";
  status.textContent = "";
  try {
    const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/remind-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: form.querySelector(".email-subject").value,
        text: form.querySelector(".email-message").value
      })
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "The reminder email was not sent.");
    const task = result.tasks.find((item) => item.id === taskId);
    if (task) task.reminders = { ...task.reminders, emailImmediate: { status: "sent", sentAt: new Date().toISOString() } };
    renderResult(result);
    const updatedStatus = results.querySelector(`[data-email-status="${CSS.escape(taskId)}"]`);
    if (updatedStatus) updatedStatus.textContent = data.message;
  } catch (error) {
    status.textContent = error.message;
    button.disabled = false;
    button.textContent = "Send email now";
  }
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
    const completed = result.tasks.filter((item) => item.status === "done").length;
    const remaining = result.tasks.length - completed;
    const nextTask = result.tasks.find((item) => item.status !== "done");
    results.querySelector(".progress-heading strong").textContent = remaining
      ? `${remaining} ${remaining === 1 ? "step" : "steps"} left`
      : "All steps complete";
    results.querySelector(".progress-count").textContent = `${completed} / ${result.tasks.length} done`;
    results.querySelector(".progress-fill").style.width = `${result.tasks.length ? Math.round(completed / result.tasks.length * 100) : 0}%`;
    results.querySelector(".progress-message").textContent = remaining
      ? `Next up: ${nextTask.action}`
      : "Nice work. Your action plan is complete.";
    results.querySelector(".next-notice-button").hidden = remaining > 0;
    const card = checkbox.closest(".task-card");
    card.classList.toggle("is-done", checkbox.checked);
    const emailButton = card.querySelector(".email-now-button");
    emailButton.disabled = checkbox.checked
      || !currentUser?.emailReminders
      || Boolean(result.tasks.find((item) => item.id === taskId)?.reminders?.emailImmediate?.sentAt);
    const emailSubmitButton = card.querySelector(".email-submit-button");
    emailSubmitButton.disabled = checkbox.checked || !currentUser?.emailReminders;
    const emailStatus = card.querySelector(".task-action-status");
    emailStatus.textContent = checkbox.checked
      ? "Email reminders are only available for pending tasks."
      : (!currentUser?.emailReminders ? "Turn on email reminders in preferences to send." : "");
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
  if (!text && !selectedFile) {
    noticeInput.focus();
    showError("Paste a notice or try the demo notice first.");
    return;
  }
  setAuthMode(false);
  setAuthMode(false);
  document.querySelector("#analysis-error").hidden = true;
  analyzeButton.disabled = true;
  analyzeButton.querySelector("span").textContent = "Reading your notice…";
  results.hidden = true;
  try {
    let route = "/api/analyze";
    let payload = { text, role: roleSelect.value };
    if (selectedFile) {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error("Could not read the selected file."));
        reader.readAsDataURL(selectedFile);
      });
      route = "/api/analyze-file";
      payload = {
        name: selectedFile.name,
        mimeType: selectedFile.type,
        data: String(dataUrl).split(",")[1],
        role: roleSelect.value
      };
    }
    const response = await fetch(route, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not analyze this notice.");
    renderResult(result);
    if (selectedFile) fileName.textContent = `${selectedFile.name} · analyzed`;
    results.scrollIntoView({ behavior: "smooth", block: "start" });
  } catch (error) {
    showError(error.message);
  } finally {
    analyzeButton.disabled = false;
    analyzeButton.querySelector("span").textContent = "Find my next steps";
  }
}

restoreSession();
