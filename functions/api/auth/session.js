import {
  checkLoginRateLimit,
  clearSessionCookie,
  createSession,
  isAuthorized,
  isSafeStateChangingRequest,
  json,
  recordLoginFailure,
  recordLoginSuccess,
  sessionCookie,
  verifyPassword
} from "../_auth.js";

export async function onRequestGet({ request, env }) {
  return json({ authenticated: await isAuthorized(request, env) });
}

export async function onRequestPost({ request, env }) {
  if (!isSafeStateChangingRequest(request)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  const rateLimit = checkLoginRateLimit(request);
  if (!rateLimit.allowed) {
    return json(
      { error: "Too many login attempts. Try again later." },
      {
        status: 429,
        headers: { "Retry-After": String(rateLimit.retryAfter) }
      }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Invalid JSON." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";

  if (!(await verifyPassword(password, env))) {
    const retryAfter = recordLoginFailure(rateLimit.key);

    return json(
      { error: "Invalid password." },
      {
        status: 401,
        headers: retryAfter ? { "Retry-After": String(retryAfter) } : {}
      }
    );
  }

  recordLoginSuccess(rateLimit.key);

  const token = await createSession(env);
  return json(
    { authenticated: true },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
}

export async function onRequestDelete({ request }) {
  if (!isSafeStateChangingRequest(request)) {
    return json({ error: "Forbidden" }, { status: 403 });
  }

  return json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}