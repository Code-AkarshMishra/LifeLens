function calendarUrl(action) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(action.deadline || "")) return "";
  const [year, month, day] = action.deadline.split("-").map(Number);
  const startDate = new Date(Date.UTC(year, month - 1, day));
  if (startDate.getUTCFullYear() !== year || startDate.getUTCMonth() !== month - 1 || startDate.getUTCDate() !== day) return "";
  const start = action.deadline.replaceAll("-", "");
  const endDate = startDate;
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

function whatsappMessage(task) {
  const deadline = task.deadline ? `\nDeadline: ${task.deadlineText || task.deadline}` : "";
  return `Hi! A LifeLens reminder: ${task.action}${deadline}\n\nFrom the notice: "${task.evidence}"\n\nPlease review this reminder and take the next step.`;
}

function whatsappUrl(task, user, customMessage = whatsappMessage(task)) {
  const savedPhone = typeof user?.phone === "string" && /^\+[1-9]\d{7,14}$/.test(user.phone)
    ? user.phone.slice(1)
    : "";
  return `https://wa.me/${savedPhone}?${new URLSearchParams({ text: customMessage })}`;
}

const reminderLinks = { calendarUrl, whatsappMessage, whatsappUrl };
if (typeof module !== "undefined" && module.exports) module.exports = reminderLinks;
if (typeof window !== "undefined") window.LifeLensReminderLinks = reminderLinks;
