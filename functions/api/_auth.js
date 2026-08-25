const SESSION_COOKIE = "thinkmark_session";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;
const SESSION_VERSION = 1;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LOCKOUT_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 5;

const loginAttempts = new Map();

function json(body, init = {}) {
  return Response.json(body, {
    ...init,
    headers: {
      ...securityHeaders(),
      ...(init.headers || {})
    }
  });
}

function base64UrlEncode(value) {
  const bytes = value instanceof Uint8Array
    ? value
    : new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function base64UrlDecode(value) {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(normalized.length + ((4 - normalized.length % 4) % 4), "=");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  return new TextDecoder().decode(bytes);
}

async function sessionKey(env) {
  const secret = env.THINKMARK_SESSION_SECRET || env.THINKMARK_PASSWORD;

  if (!secret) {
    throw new Error("Missing THINKMARK_PASSWORD.");
  }

  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function sign(value, env) {
  const key = await sessionKey(env);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );

  return base64UrlEncode(new Uint8Array(signature));
}

async function verifySignature(value, signature, env) {
  const expected = await sign(value, env);
  return constantTimeEqual(expected, signature);
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string") return false;

  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index++) {
    diff |= (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }

  return diff === 0;
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const cookies = new Map();

  for (const part of header.split(";")) {
    const [rawName, ...rawValue] = part.trim().split("=");
    if (!rawName) continue;
    cookies.set(rawName, rawValue.join("="));
  }

  return cookies;
}

function sessionCookie(value, maxAge = SESSION_MAX_AGE_SECONDS) {
  const expires = maxAge === 0
    ? "; Expires=Thu, 01 Jan 1970 00:00:00 GMT"
    : "";

  return `${SESSION_COOKIE}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}${expires}`;
}

export function clearSessionCookie() {
  return sessionCookie("", 0);
}

export async function createSession(env) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64UrlEncode(JSON.stringify({
    v: SESSION_VERSION,
    iat: now,
    exp: now + SESSION_MAX_AGE_SECONDS,
    nonce: crypto.randomUUID()
  }));
  const signature = await sign(payload, env);

  return `${payload}.${signature}`;
}

export async function isAuthorized(request, env) {
  const token = parseCookies(request).get(SESSION_COOKIE);
  if (!token) return false;

  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;

  if (!(await verifySignature(payload, signature, env))) return false;

  try {
    const session = JSON.parse(base64UrlDecode(payload));
    const now = Math.floor(Date.now() / 1000);

    return session.v === SESSION_VERSION &&
      Number.isFinite(session.exp) &&
      session.exp > now;
  } catch {
    return false;
  }
}

export function unauthorized() {
  return json({ error: "Unauthorized" }, { status: 401 });
}

export function forbidden() {
  return json({ error: "Forbidden" }, { status: 403 });
}

export function securityHeaders() {
  return {
    "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-src 'none'; frame-ancestors 'none'; media-src 'none'; worker-src 'none'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), accelerometer=(), gyroscope=(), magnetometer=()"
  };
}

export function withSecurityHeaders(response) {
  const headers = new Headers(response.headers);

  for (const [name, value] of Object.entries(securityHeaders())) {
    headers.set(name, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function isSafeStateChangingRequest(request) {
  const method = request.method.toUpperCase();
  if (["GET", "HEAD", "OPTIONS"].includes(method)) return true;

  const url = new URL(request.url);
  const origin = request.headers.get("Origin");
  const referer = request.headers.get("Referer");
  const fetchSite = request.headers.get("Sec-Fetch-Site");

  if (fetchSite && !["same-origin", "none"].includes(fetchSite)) {
    return false;
  }

  if (origin) {
    return origin === url.origin;
  }

  if (referer) {
    return new URL(referer).origin === url.origin;
  }

  return true;
}

export function clientKey(request) {
  return request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "unknown";
}

export function checkLoginRateLimit(request) {
  const key = clientKey(request);
  const now = Date.now();
  const attempt = loginAttempts.get(key);

  if (!attempt) return { allowed: true, key };

  if (attempt.lockedUntil && attempt.lockedUntil > now) {
    return {
      allowed: false,
      key,
      retryAfter: Math.ceil((attempt.lockedUntil - now) / 1000)
    };
  }

  if (attempt.windowStarted + LOGIN_WINDOW_MS < now) {
    loginAttempts.delete(key);
  }

  return { allowed: true, key };
}

export function recordLoginSuccess(key) {
  loginAttempts.delete(key);
}

export function recordLoginFailure(key) {
  const now = Date.now();
  const current = loginAttempts.get(key);
  const windowStarted = current && current.windowStarted + LOGIN_WINDOW_MS > now
    ? current.windowStarted
    : now;
  const failures = current && current.windowStarted + LOGIN_WINDOW_MS > now
    ? current.failures + 1
    : 1;
  const lockouts = failures >= LOGIN_MAX_FAILURES
    ? (current?.lockouts || 0) + 1
    : current?.lockouts || 0;
  const lockedUntil = failures >= LOGIN_MAX_FAILURES
    ? now + LOGIN_LOCKOUT_MS * Math.min(lockouts, 4)
    : 0;

  loginAttempts.set(key, {
    failures,
    lockouts,
    lockedUntil,
    windowStarted
  });

  return lockedUntil
    ? Math.ceil((lockedUntil - now) / 1000)
    : 0;
}

export async function verifyPassword(password, env) {
  return constantTimeEqual(password, env.THINKMARK_PASSWORD || "");
}

export { json, sessionCookie };
