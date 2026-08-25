import { clearSessionCookie } from "../_auth.js";

export async function onRequestPost() {
  return Response.json(
    { authenticated: false },
    { headers: { "Set-Cookie": clearSessionCookie() } }
  );
}
