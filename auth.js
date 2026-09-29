const crypto = require("crypto");
const nodemailer = require("nodemailer");

const CODE_TTL_MS = 10 * 60 * 1000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 5;

const otpStore = new Map();
const sessions = new Map();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_APP_PASSWORD,
  },
});

function isValidEmail(email) {
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function sendCode(email) {
  const code = crypto.randomInt(100000, 1000000).toString();

  otpStore.set(email, {
    code,
    expiresAt: Date.now() + CODE_TTL_MS,
    attempts: 0,
  });

  await transporter.sendMail({
    from: process.env.GMAIL_USER,
    to: email,
    subject: "Your Printroom verification code",
    text: `Your verification code is ${code}. It expires in 10 minutes.`,
    html: `<p>Your verification code is <b>${code}</b>.</p><p>It expires in 10 minutes.</p>`,
  });
}

function verifyCode(email, code) {
  const entry = otpStore.get(email);

  if (!entry) {
    return { success: false, message: "No code was requested for this email" };
  }

  if (Date.now() > entry.expiresAt) {
    otpStore.delete(email);
    return { success: false, message: "Code has expired" };
  }

  entry.attempts += 1;

  if (entry.attempts > MAX_ATTEMPTS) {
    otpStore.delete(email);
    return { success: false, message: "Too many attempts, request a new code" };
  }

  if (entry.code !== code) {
    return { success: false, message: "Incorrect code" };
  }

  otpStore.delete(email);

  const token = crypto.randomBytes(32).toString("hex");
  sessions.set(token, { email, expiresAt: Date.now() + SESSION_TTL_MS });

  return { success: true, token };
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ success: false, message: "Missing authorization token" });
  }

  const session = sessions.get(token);

  if (!session || Date.now() > session.expiresAt) {
    sessions.delete(token);
    return res.status(401).json({ success: false, message: "Session expired, please sign in again" });
  }

  req.userEmail = session.email;
  next();
}

module.exports = { isValidEmail, sendCode, verifyCode, requireAuth };
