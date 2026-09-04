import { forbidden, isAuthorized, isSafeStateChangingRequest, unauthorized } from "../_auth.js";
import { triggerNotesBackup } from "../_backup.js";
import { supabaseRequest } from "../_supabase.js";

const CODE_PATTERN = /^[a-z0-9]{4}$/;
const MAX_TITLE_LENGTH = 200;
const MAX_TAGS = 30;
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function validCode(code) {
  return CODE_PATTERN.test(code);
}

function normalizeTags(value) {
  if (!Array.isArray(value)) return [];

  const tags = [];
  const seen = new Set();

  for (const rawTag of value) {
    if (typeof rawTag !== "string") continue;

    const tag = rawTag.trim().replace(/^#+/, "").toLowerCase();
    if (!TAG_PATTERN.test(tag) || seen.has(tag)) continue;

    seen.add(tag);
    tags.push(tag);
  }

  return tags.slice(0, MAX_TAGS);
}

export async function onRequestGet({ params, request, env }) {
  if (!(await isAuthorized(request, env))) return unauthorized();

  const code = params.code?.toLowerCase();

  if (!validCode(code)) {
    return Response.json(
      { error: "Invalid code." },
      { status: 400 }
    );
  }

  const response = await supabaseRequest(
    env,
    `notes?select=code,title,content,tags,created_at,updated_at&code=eq.${encodeURIComponent(code)}`
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
  if (!(await isAuthorized(request, env))) return unauthorized();
  if (!isSafeStateChangingRequest(request)) return forbidden();

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
  const title = typeof body.title === "string"
    ? body.title.trim()
    : "";
  const tags = normalizeTags(body.tags);

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

  if (title.length > MAX_TITLE_LENGTH) {
    return Response.json(
      { error: "Title is too long." },
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
        title: title || null,
        content,
        tags,
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
  if (!(await isAuthorized(request, env))) return unauthorized();
  if (!isSafeStateChangingRequest(request)) return forbidden();

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
