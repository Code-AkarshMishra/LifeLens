const crypto = require("node:crypto");
const { promisify } = require("node:util");
const db = require("./db");

const scrypt = promisify(crypto.scrypt);
const COOKIE_NAME = "lifelens_session";
const SESSION_DAYS = 30;

function normalizeEmail(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function isValidEmail(email) {
  return email.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function parseCookie(header, name) {
  for (const item of (header || "").split(";")) {
    const [key, ...value] = item.trim().split("=");
    if (key === name) {
      try {
        return decodeURIComponent(value.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

async function hashPassword(password, salt = crypto.randomBytes(16).toString("hex")) {
  const derived = await scrypt(password, salt, 64);
  return { passwordSalt: salt, passwordHash: derived.toString("hex") };
}

async function verifyPassword(password, user) {
  if (!user?.passwordSalt || !user?.passwordHash) {
    await hashPassword(password);
    return false;
  }
  const { passwordHash } = await hashPassword(password, user.passwordSalt);
  const actual = Buffer.from(passwordHash, "hex");
  const expected = Buffer.from(user.passwordHash, "hex");
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function tokenDigest(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`);
}

function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader("Set-Cookie", `${COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
}

async function createLoginSession(req, res, userId) {
  const previousToken = parseCookie(req.headers.cookie, COOKIE_NAME);
  if (previousToken) await db.deleteSession(tokenDigest(previousToken));
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await db.createSession({ tokenHash: tokenDigest(token), userId, expiresAt });
  setSessionCookie(res, token);
}

async function authenticate(req, _res, next) {
  try {
    const token = parseCookie(req.headers.cookie, COOKIE_NAME);
    const principal = token ? await db.getSessionUser(tokenDigest(token)) : null;
    req.userId = principal?.id;
    if (principal) delete principal.id;
    req.user = principal;
    if (!req.user) return next(Object.assign(new Error("Authentication required."), { status: 401 }));
    next();
  } catch (error) {
    next(error);
  }
}

module.exports = {
  COOKIE_NAME, parseCookie, normalizeEmail, isValidEmail, hashPassword, verifyPassword,
  tokenDigest, setSessionCookie, clearSessionCookie, createLoginSession, authenticate
};
