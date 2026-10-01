async function sendReminder(task, user) {
  const { TWILIO_ACCOUNT_SID: sid, TWILIO_AUTH_TOKEN: token, TWILIO_WHATSAPP_FROM: from } = process.env;
  if (!sid || !token || !from || !user?.phone) return false;
  const body = new URLSearchParams({
    From: from,
    To: `whatsapp:${user.phone}`,
    Body: `LifeLens reminder: ${task.action}\nDeadline: ${task.deadline || "See notice"}`
  });
  const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  if (!response.ok) throw new Error(`Twilio returned HTTP ${response.status}: ${await response.text()}`);
  return true;
}

module.exports = { sendReminder };
