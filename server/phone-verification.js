function configuration() {
  const { TWILIO_ACCOUNT_SID: accountSid, TWILIO_AUTH_TOKEN: authToken, TWILIO_VERIFY_SERVICE_SID: serviceSid } = process.env;
  if (!accountSid || !authToken || !serviceSid) return null;
  return { accountSid, authToken, serviceSid };
}

async function callVerifyApi(path, fields) {
  const config = configuration();
  if (!config) throw new Error("Twilio Verify is not configured.");
  const credentials = Buffer.from(`${config.accountSid}:${config.authToken}`).toString("base64");
  const response = await fetch(
    `https://verify.twilio.com/v2/Services/${encodeURIComponent(config.serviceSid)}/${path}`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams(fields)
    }
  );
  if (!response.ok) {
    const error = new Error("Twilio Verify request failed.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

async function sendCode(phone) {
  return callVerifyApi("Verifications", { To: phone, Channel: "sms" });
}

async function checkCode(phone, code) {
  return callVerifyApi("VerificationCheck", { To: phone, Code: code });
}

module.exports = { isConfigured: () => Boolean(configuration()), sendCode, checkCode };
