export function supabaseHeaders(env) {
  return {
    "apikey": env.SUPABASE_SECRET_KEY,
    "Authorization": `Bearer ${env.SUPABASE_SECRET_KEY}`,
    "Content-Type": "application/json"
  };
}

export async function supabaseRequest(env, path, options = {}) {
  const response = await fetch(`${env.SUPABASE_URL}/rest/v1/${path}`, {
    ...options,
    headers: {
      ...supabaseHeaders(env),
      ...(options.headers || {})
    }
  });

  return response;
}
