const db = require("./db");
const mailer = require("./mailer");
const whatsapp = require("./whatsapp");

async function sendDueReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tasks = await db.getDueTasks(tomorrow.toISOString().slice(0, 10));
  for (const task of tasks) {
    for (const [channel, sender] of [["email", mailer.sendReminder], ["whatsapp", whatsapp.sendReminder]]) {
      if (task.reminders?.[channel]?.sentAt) continue;
      try {
        if (await sender(task)) {
          await db.markReminder(task.id, channel, { sentAt: new Date().toISOString() });
        }
      } catch (error) {
        console.error(`Failed to send ${channel} reminder for task ${task.id}: ${error.message}`);
        await db.markReminder(task.id, channel, { lastError: error.message, attemptedAt: new Date().toISOString() });
      }
    }
  }
}

function startScheduler() {
  setInterval(() => {
    sendDueReminders().catch((error) => console.error(`Reminder scheduler failed: ${error.message}`));
  }, 60 * 60 * 1000).unref();
  sendDueReminders().catch((error) => console.error(`Reminder scheduler failed: ${error.message}`));
}

module.exports = { startScheduler };
