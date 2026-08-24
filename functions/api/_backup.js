import { supabaseRequest } from "./_supabase.js";

const BACKUP_PATH = "thinkmark-backup.json";
const BACKUP_MESSAGE = "Update ThinkMark backup";

function toBase64(value) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}

async function fetchAllNotes(env) {
  const response = await supabaseRequest(
    env,
    "notes?select=code,content,created_at,updated_at&order=created_at.asc"
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Supabase backup fetch failed: ${response.status} ${text}`);
  }

  return response.json();
}

async function getExistingBackupSha(env) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_BACKUP_REPO}/contents/${BACKUP_PATH}`,
    {
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "User-Agent": "ThinkMark-Backup"
      }
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub backup lookup failed: ${response.status} ${text}`);
  }

  const payload = await response.json();
  return payload.sha ?? null;
}

async function uploadBackup(env, content, sha) {
  const response = await fetch(
    `https://api.github.com/repos/${env.GITHUB_BACKUP_REPO}/contents/${BACKUP_PATH}`,
    {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "User-Agent": "ThinkMark-Backup"
      },
      body: JSON.stringify({
        message: BACKUP_MESSAGE,
        content: toBase64(content),
        ...(sha ? { sha } : {})
      })
    }
  );

  return response;
}

export async function backupNotesToGitHub(env) {
  if (!env.GITHUB_TOKEN || !env.GITHUB_BACKUP_REPO) {
    throw new Error("Missing GITHUB_TOKEN or GITHUB_BACKUP_REPO.");
  }

  const notes = await fetchAllNotes(env);
  const content = JSON.stringify({ notes }, null, 2);
  let sha = await getExistingBackupSha(env);
  let response = await uploadBackup(env, content, sha);

  if (response.status === 409 || response.status === 422) {
    sha = await getExistingBackupSha(env);
    response = await uploadBackup(env, content, sha);
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub backup upload failed: ${response.status} ${text}`);
  }
}

export function triggerNotesBackup(waitUntil, env) {
  const backupPromise = backupNotesToGitHub(env).catch((error) => {
    console.error("ThinkMark backup failed:", error);
  });

  if (typeof waitUntil === "function") {
    waitUntil(backupPromise);
    return;
  }

  return backupPromise;
}
