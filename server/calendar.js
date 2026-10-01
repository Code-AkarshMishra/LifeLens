function escapeIcs(value) {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line) {
  let current = "";
  let length = 0;
  const folded = [];
  for (const character of line) {
    const bytes = Buffer.byteLength(character);
    if (current && length + bytes > 75) {
      folded.push(current);
      current = " ";
      length = 1;
    }
    current += character;
    length += bytes;
  }
  folded.push(current);
  return folded.join("\r\n");
}

function formatUtcDate(date) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function createTaskIcs(task, now = new Date()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(task.deadline || "")) {
    throw new Error("A valid task deadline is required to create a calendar event.");
  }
  const [year, month, day] = task.deadline.split("-").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day));
  if (start.getUTCFullYear() !== year || start.getUTCMonth() !== month - 1 || start.getUTCDate() !== day) {
    throw new Error("The task deadline is not a valid calendar date.");
  }
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  const uid = `${escapeIcs(task.id)}@lifelens`;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//LifeLens//Task Reminder//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${formatUtcDate(now)}`,
    `DTSTART;VALUE=DATE:${task.deadline.replace(/-/g, "")}`,
    `DTEND;VALUE=DATE:${end.toISOString().slice(0, 10).replace(/-/g, "")}`,
    `SUMMARY:${escapeIcs(task.action)}`,
    `DESCRIPTION:${escapeIcs(`From your notice: ${task.evidence || ""}`)}`,
    "END:VEVENT",
    "END:VCALENDAR",
    ""
  ];
  return lines.map(foldLine).join("\r\n");
}

module.exports = { createTaskIcs };
