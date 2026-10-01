const noticeInput = document.querySelector("#notice");
const roleSelect = document.querySelector("#role");
const analyzeButton = document.querySelector("#analyze-button");
const results = document.querySelector("#results");
const charCount = document.querySelector("#char-count");

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
    <h2 class="actions-title">What to do <small>${actions.length} ${actions.length === 1 ? "action" : "actions"}</small></h2>
    ${actions.length ? actions.map((action) => {
      const task = taskByEvidence.get(action.evidence);
      const link = calendarUrl(action);
      return `<article class="task-card">
        <div class="task-main">
          <input class="task-toggle" type="checkbox" aria-label="Mark task done" data-task="${escapeHtml(task?.id || "")}" ${task?.status === "done" ? "checked" : ""} ${task?.id ? "" : "disabled"}>
          <div class="task-copy ${task?.status === "done" ? "done" : ""}">${escapeHtml(action.action)}</div>
          <span class="priority ${action.priority === "High" ? "high" : ""}">${escapeHtml(action.priority || "Normal")} priority</span>
        </div>
        <div class="task-meta">${action.deadline ? `<strong>Deadline:</strong> ${escapeHtml(action.deadlineText || action.deadline)} · ${escapeHtml(action.deadline)}` : "<strong>Deadline:</strong> Not specified"}<br><strong>If missed:</strong> ${escapeHtml(action.consequence)}</div>
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
  let error = document.querySelector(".error-message");
  if (!error) {
    error = document.createElement("p");
    error.className = "error-message";
    analyzeButton.after(error);
  }
  error.textContent = message;
}

async function runAnalysis() {
  const text = noticeInput.value.trim();
  if (!text) {
    noticeInput.focus();
    showError("Paste a notice or try the demo notice first.");
    return;
  }
  document.querySelector(".error-message")?.remove();
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
