import {
  checkLoginRateLimit,
  createSession,
  recordLoginFailure,
  recordLoginSuccess,
  sessionCookie,
  verifyPassword
} from "../_auth.js";

export async function onRequestPost({ request, env }) {
  const rateLimit = checkLoginRateLimit(request);

  if (!rateLimit.allowed) {
    return Response.json(
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
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }

  const password = typeof body.password === "string" ? body.password : "";

  if (!(await verifyPassword(password, env))) {
    const retryAfter = recordLoginFailure(rateLimit.key);

    return Response.json(
      { error: "Invalid password." },
      {
        status: 401,
        headers: retryAfter ? { "Retry-After": String(retryAfter) } : {}
      }
    );
  }

  recordLoginSuccess(rateLimit.key);

  const token = await createSession(env);

  return Response.json(
    { authenticated: true },
    { headers: { "Set-Cookie": sessionCookie(token) } }
  );
}
