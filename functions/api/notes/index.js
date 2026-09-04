import { forbidden, isAuthorized, isSafeStateChangingRequest, unauthorized } from "../_auth.js";
import { triggerNotesBackup } from "../_backup.js";
import { supabaseRequest } from "../_supabase.js";

const CODE_CHARS = "abcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 4;
const MAX_TITLE_LENGTH = 200;
const MAX_TAGS = 30;
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;

function generateCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  let code = "";

  for (const byte of bytes) {
    code += CODE_CHARS[byte % CODE_CHARS.length];
  }

  return code;
}

async function uniqueCode(env) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = generateCode();

    const response = await supabaseRequest(
      env,
      `notes?select=code&code=eq.${encodeURIComponent(code)}`
    );

    if (!response.ok) {
      throw new Error("Database lookup failed.");
    }

    const rows = await response.json();

    if (rows.length === 0) {
      return code;
    }
  }

  throw new Error("Could not generate a unique code.");
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

export async function onRequestGet({ request, env }) {
  if (!(await isAuthorized(request, env))) return unauthorized();

  const url = new URL(request.url);
  const sort = url.searchParams.get("sort") === "oldest"
    ? "created_at.asc"
    : "created_at.desc";

  const response = await supabaseRequest(
    env,
    `notes?select=code,title,content,tags,created_at,updated_at&order=${sort}`
  );

  if (!response.ok) {
    return Response.json(
      { error: "Could not load notes." },
      { status: 500 }
    );
  }

  return Response.json(await response.json());
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!(await isAuthorized(request, env))) return unauthorized();
  if (!isSafeStateChangingRequest(request)) return forbidden();

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

  try {
    const code = await uniqueCode(env);

    const response = await supabaseRequest(env, "notes", {
      method: "POST",
      headers: {
        "Prefer": "return=representation"
      },
      body: JSON.stringify({
        code,
        title: title || null,
        content,
        tags
      })
    });

    if (!response.ok) {
      const text = await response.text();
      console.error(text);

      return Response.json(
        { error: "Could not save note." },
        { status: 500 }
      );
    }

    const rows = await response.json();
    triggerNotesBackup(waitUntil, env);

    return Response.json(rows[0], { status: 201 });
  } catch (error) {
    console.error(error);

    return Response.json(
      { error: "Could not create note." },
      { status: 500 }
    );
  }
}
