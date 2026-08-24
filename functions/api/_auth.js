export function isAuthorized(request, env) {
  const password = request.headers.get("X-ThinkMark-Password");
  return Boolean(password && env.THINKMARK_PASSWORD && password === env.THINKMARK_PASSWORD);
}

export function unauthorized() {
  return Response.json(
    { error: "Unauthorized" },
    { status: 401 }
  );
}
