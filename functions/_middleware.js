import { withSecurityHeaders } from "./api/_auth.js";

export async function onRequest(context) {
  const response = await context.next();
  return withSecurityHeaders(response);
}