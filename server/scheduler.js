const db = require("./db");
const mailer = require("./mailer");
const whatsapp = require("./whatsapp");

async function sendDueReminders() {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tasks = await db.getDueTasks(tomorrow.toISOString().slice(0, 10));
  for (const task of tasks) {
    for (const [channel, enabled, sender] of [
      ["email", task.owner.emailReminders, mailer.sendReminder],
      ["whatsapp", task.owner.whatsappReminders, whatsapp.sendReminder]
    ]) {
      const previous = task.reminders?.[channel] || {};
      if (previous.sentAt || previous.status === "sent") continue;
      const attemptedAt = new Date().toISOString();
      if (!enabled) {
        await db.markReminder(task.ownerId, task.id, channel, { status: "opted_out", attemptedAt });
        continue;
      }
      if (channel === "whatsapp" && !task.owner.phoneVerified) {
        await db.markReminder(task.ownerId, task.id, channel, { status: "phone_unverified", attemptedAt });
        continue;
      }
      if (!await db.claimReminder(task.ownerId, task.id, channel)) continue;
      try {
        if (await sender(task, task.owner)) {
          await db.markReminder(task.ownerId, task.id, channel, { status: "sent", sentAt: attemptedAt });
        } else {
          await db.markReminder(task.ownerId, task.id, channel, { status: "not_configured", attemptedAt });
        }
      } catch (error) {
        const sameFailure = previous.status === "error" && previous.lastError === error.message;
        await db.markReminder(task.ownerId, task.id, channel, {
          status: "error", lastError: error.message, attemptedAt
        });
        if (!sameFailure) console.error(`Failed to send ${channel} reminder for task ${task.id}: ${error.message}`);
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

module.exports = { startScheduler, sendDueReminders };
