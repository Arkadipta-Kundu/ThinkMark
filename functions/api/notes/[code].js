import { isAuthorized, unauthorized } from "../_auth.js";
import { triggerNotesBackup } from "../_backup.js";
import { supabaseRequest } from "../_supabase.js";

function validCode(code) {
  return /^[a-z0-9]{5}$/.test(code);
}

export async function onRequestGet({ params, request, env }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const code = params.code?.toLowerCase();

  if (!validCode(code)) {
    return Response.json(
      { error: "Invalid code." },
      { status: 400 }
    );
  }

  const response = await supabaseRequest(
    env,
    `notes?select=code,content,created_at,updated_at&code=eq.${encodeURIComponent(code)}`
  );

  if (!response.ok) {
    return Response.json(
      { error: "Database error." },
      { status: 500 }
    );
  }

  const rows = await response.json();

  if (rows.length === 0) {
    return Response.json(
      { error: "Note not found." },
      { status: 404 }
    );
  }

  return Response.json(rows[0]);
}

export async function onRequestPut({ params, request, env, waitUntil }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const code = params.code?.toLowerCase();

  if (!validCode(code)) {
    return Response.json(
      { error: "Invalid code." },
      { status: 400 }
    );
  }

  let body;

  try {
    body = await request.json();
  } catch {
    return Response.json(
      { error: "Invalid JSON." },
      { status: 400 }
    );
  }

  const content = typeof body.content === "string"
    ? body.content.trim()
    : "";

  if (!content) {
    return Response.json(
      { error: "Content is required." },
      { status: 400 }
    );
  }

  if (content.length > 100000) {
    return Response.json(
      { error: "Note is too large." },
      { status: 400 }
    );
  }

  const response = await supabaseRequest(
    env,
    `notes?code=eq.${encodeURIComponent(code)}`,
    {
      method: "PATCH",
      headers: {
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        content,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    return Response.json(
      { error: "Could not update note." },
      { status: 500 }
    );
  }

  const rows = await response.json();

  if (rows.length === 0) {
    return Response.json(
      { error: "Note not found." },
      { status: 404 }
    );
  }

  triggerNotesBackup(waitUntil, env);
  return Response.json(rows[0]);
}

export async function onRequestDelete({ params, request, env, waitUntil }) {
  if (!isAuthorized(request, env)) return unauthorized();

  const code = params.code?.toLowerCase();

  if (!validCode(code)) {
    return Response.json(
      { error: "Invalid code." },
      { status: 400 }
    );
  }

  const response = await supabaseRequest(
    env,
    `notes?code=eq.${encodeURIComponent(code)}`,
    {
      method: "DELETE"
    }
  );

  if (!response.ok) {
    return Response.json(
      { error: "Could not delete note." },
      { status: 500 }
    );
  }

  triggerNotesBackup(waitUntil, env);
  return Response.json({ success: true });
}
