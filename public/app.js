const state = {
  currentView: "home",
  currentNote: null,
  editingCode: null,
  editorDoneMode: false,
  editorReturnView: "home",
  notes: []
};

const NOTE_CODE_LENGTH = 4;
const NOTE_CODE_PATTERN = new RegExp(`^[a-z0-9]{${NOTE_CODE_LENGTH}}$`);
const THEME_STORAGE_KEY = "thinkmark-theme";
const THEMES = {
  light: {
    label: "Switch to dark mode",
    themeColor: "#f7f7f5"
  },
  dark: {
    label: "Switch to light mode",
    themeColor: "#111210"
  }
};

const $ = (selector) => document.querySelector(selector);

const passwordModal = $("#passwordModal");
const passwordForm = $("#passwordForm");
const passwordInput = $("#passwordInput");
const loginError = $("#loginError");
const themeToggle = $("#themeToggle");

function showLogin() {
  passwordModal.style.display = "grid";
  setTimeout(() => passwordInput.focus(), 100);
}

function hideLogin() {
  passwordModal.style.display = "none";
}

function getStoredTheme() {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    return theme === "dark" || theme === "light" ? theme : "light";
  } catch {
    return "light";
  }
}

function applyTheme(theme) {
  const activeTheme = theme === "dark" ? "dark" : "light";
  const themeConfig = THEMES[activeTheme];

  document.documentElement.dataset.theme = activeTheme;
  $("#themeColorMeta")?.setAttribute("content", themeConfig.themeColor);
  themeToggle?.setAttribute("aria-label", themeConfig.label);
  themeToggle?.setAttribute("title", themeConfig.label);
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark"
    ? "light"
    : "dark";

  applyTheme(nextTheme);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
  } catch {}
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove("show");
  }, 2200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    showLogin();
    throw new Error("Unauthorized");
  }

  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || "Something went wrong.");
  }

  return body;
}

function showView(viewName) {
  state.currentView = viewName;

  document.querySelectorAll(".view").forEach(view => {
    view.classList.remove("active-view");
  });

  const target = $(`#${viewName}View`);
  if (target) target.classList.add("active-view");

  document.querySelectorAll(".nav-link").forEach(link => {
    link.classList.toggle("active", link.dataset.view === viewName);
  });

  window.scrollTo({ top: 0, behavior: "smooth" });

  if (viewName === "home") loadRecent();
  if (viewName === "notes") loadAllNotes();
}

function formatDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric"
  }).format(new Date(value));
}

function preview(text) {
  return text.replace(/\s+/g, " ").trim().slice(0, 100);
}

function normalizeTitle(value) {
  if (typeof value !== "string") return null;

  const title = value.trim();
  return title || null;
}

function renderNoteRows(notes, container) {
  if (!notes.length) {
    container.innerHTML = `<div class="empty-state">No notes yet.</div>`;
    return;
  }

  container.innerHTML = notes.map(note => `
    <button class="note-row" data-code="${escapeHtml(note.code)}">
      <span class="row-code">${escapeHtml(note.code)}</span>
      <span class="row-preview">${escapeHtml(preview(note.content))}</span>
      <span class="row-date">${formatDate(note.created_at)}</span>
    </button>
  `).join("");

  container.querySelectorAll(".note-row").forEach(row => {
    row.addEventListener("click", () => openNote(row.dataset.code));
  });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replaceAll("`", "&#096;");
}

function isSafeUrl(value) {
  try {
    const url = new URL(value, window.location.origin);
    return ["http:", "https:", "mailto:"].includes(url.protocol);
  } catch {
    return false;
  }
}

function renderInlineMarkdown(text) {
  const codeParts = [];
  const placeholder = (index) => `\u0000CODE${index}\u0000`;

  let html = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const index = codeParts.push(`<code>${escapeHtml(code)}</code>`) - 1;
    return placeholder(index);
  });

  html = escapeHtml(html)
    .replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (match, label, href) => {
      const decodedHref = href.replaceAll("&amp;", "&");
      if (!isSafeUrl(decodedHref)) return match;

      return `<a href="${escapeAttribute(decodedHref)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  codeParts.forEach((code, index) => {
    html = html.replaceAll(escapeHtml(placeholder(index)), code);
  });

  return html;
}

function renderMarkdown(markdown) {
  const lines = String(markdown).replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];

    if (!line.trim()) {
      index += 1;
      continue;
    }

    if (line.trimStart().startsWith("```")) {
      const codeLines = [];
      index += 1;

      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) index += 1;
      blocks.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2].trim())}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*[-*]\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*\d+[.)]\s+/, ""))}</li>`);
        index += 1;
      }
      blocks.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && /^\s*>\s?/.test(lines[index])) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, "").trim());
        index += 1;
      }
      blocks.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join(" "))}</p></blockquote>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !lines[index].trimStart().startsWith("```") &&
      !/^(#{1,6})\s+/.test(lines[index]) &&
      !/^\s*[-*]\s+/.test(lines[index]) &&
      !/^\s*\d+[.)]\s+/.test(lines[index]) &&
      !/^\s*>\s?/.test(lines[index])
    ) {
      paragraph.push(lines[index].trim());
      index += 1;
    }

    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "))}</p>`);
  }

  return sanitizeRenderedMarkdown(blocks.join(""));
}

function sanitizeRenderedMarkdown(html) {
  const template = document.createElement("template");
  const allowedTags = new Set([
    "A", "BLOCKQUOTE", "CODE", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "OL", "P", "PRE", "STRONG", "UL"
  ]);
  const allowedAttributes = {
    A: new Set(["href", "rel", "target"])
  };

  template.innerHTML = html;

  template.content.querySelectorAll("*").forEach(element => {
    if (!allowedTags.has(element.tagName)) {
      element.replaceWith(document.createTextNode(element.textContent));
      return;
    }

    [...element.attributes].forEach(attribute => {
      const allowed = allowedAttributes[element.tagName]?.has(attribute.name);
      if (!allowed) element.removeAttribute(attribute.name);
    });

    if (element.tagName === "A" && !isSafeUrl(element.getAttribute("href"))) {
      element.removeAttribute("href");
    }
  });

  return template.innerHTML;
}

async function loadRecent() {
  try {
    const notes = await api("/api/notes?sort=newest");
    state.notes = notes;
    renderNoteRows(notes.slice(0, 5), $("#recentList"));
  } catch (error) {
    if (error.message !== "Unauthorized") {
      $("#recentList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

async function loadAllNotes() {
  $("#allNotesList").innerHTML = `<div class="empty-state">Loading...</div>`;

  try {
    const sort = $("#sortSelect").value;
    const notes = await api(`/api/notes?sort=${sort}`);
    state.notes = notes;
    renderFilteredNotes();
  } catch (error) {
    if (error.message !== "Unauthorized") {
      $("#allNotesList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

function renderFilteredNotes() {
  const query = $("#listSearch").value.trim().toLowerCase();

  const filtered = state.notes.filter(note =>
    note.code.includes(query) ||
    note.content.toLowerCase().includes(query)
  );

  renderNoteRows(filtered, $("#allNotesList"));
}

async function openNote(code) {
  try {
    const note = await api(`/api/notes/${encodeURIComponent(code)}`);
    state.currentNote = note;

    $("#noteCode").textContent = note.code;
    $("#noteTitleView").textContent = note.title || "";
    $("#noteTitleView").hidden = !note.title;
    $("#noteDate").textContent =
      `Created ${formatDate(note.created_at)} · Updated ${formatDate(note.updated_at)}`;

    $("#noteContentView").innerHTML = renderMarkdown(note.content);

    showView("note");
  } catch (error) {
    if (error.message !== "Unauthorized") {
      showToast(error.message);
    }
  }
}

function openNewNote() {
  state.editingCode = null;
  state.editorDoneMode = false;
  state.editorReturnView = "home";

  $("#editorMode").textContent = "NEW NOTE";
  $("#codePreview").textContent = "?".repeat(NOTE_CODE_LENGTH);
  $("#noteTitle").value = "";
  $("#noteContent").value = "";
  $("#noteTitle").readOnly = false;
  $("#noteContent").readOnly = false;
  $("#saveBtn").style.display = "";
  $("#cancelBtn").textContent = "Cancel";
  updateCharCount();
  $("#saveBtn").textContent = "Save & get code";

  showView("editor");
  setTimeout(() => $("#noteTitle").focus(), 50);
}

function openEditorForNote(note) {
  state.editingCode = note.code;
  state.editorDoneMode = false;
  state.editorReturnView = "note";

  $("#editorMode").textContent = "EDIT NOTE";
  $("#codePreview").textContent = note.code;
  $("#noteTitle").value = note.title || "";
  $("#noteContent").value = note.content;
  $("#noteTitle").readOnly = false;
  $("#noteContent").readOnly = false;
  $("#saveBtn").style.display = "";
  $("#cancelBtn").textContent = "Back";
  updateCharCount();
  $("#saveBtn").textContent = "Save changes";

  showView("editor");
  setTimeout(() => $("#noteTitle").focus(), 50);
}

async function saveNote() {
  const title = normalizeTitle($("#noteTitle").value);
  const content = $("#noteContent").value.trim();

  if (!content) {
    showToast("Write something first.");
    $("#noteContent").focus();
    return;
  }

  const button = $("#saveBtn");
  button.disabled = true;

  try {
    if (state.editingCode) {
      const note = await api(
        `/api/notes/${encodeURIComponent(state.editingCode)}`,
        {
          method: "PUT",
          body: JSON.stringify({ title, content })
        }
      );

      state.currentNote = note;
      $("#codePreview").textContent = note.code;
      showToast("Saved.");
      await openNote(note.code);
    } else {
      const note = await api("/api/notes", {
        method: "POST",
        body: JSON.stringify({ title, content })
      });

      state.currentNote = note;
      showCodeSaved(note.code);
    }
  } catch (error) {
    if (error.message !== "Unauthorized") {
      showToast(error.message);
    }
  } finally {
    button.disabled = false;
  }
}

function showCodeSaved(code) {
  state.editorDoneMode = true;
  state.editorReturnView = "home";
  $("#editorMode").textContent = "SAVED";
  $("#codePreview").textContent = code;
  $("#noteTitle").readOnly = true;
  $("#noteContent").readOnly = true;
  $("#saveBtn").style.display = "none";
  $("#cancelBtn").textContent = "Done";

  navigator.clipboard?.writeText(code).catch(() => {});
  showToast(`Your code is ${code}`);
}

async function deleteCurrentNote() {
  if (!state.currentNote) return;

  const confirmed = confirm(
    `Delete note ${state.currentNote.code}? This cannot be undone.`
  );

  if (!confirmed) return;

  try {
    await api(
      `/api/notes/${encodeURIComponent(state.currentNote.code)}`,
      { method: "DELETE" }
    );

    state.currentNote = null;
    showToast("Note deleted.");
    showView("home");
  } catch (error) {
    if (error.message !== "Unauthorized") {
      showToast(error.message);
    }
  }
}

async function exportNotes() {
  try {
    const notes = await api("/api/notes?sort=oldest");

    const blob = new Blob(
      [JSON.stringify(notes, null, 2)],
      { type: "application/json" }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `thinkmark-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();

    URL.revokeObjectURL(url);

    showToast("Backup downloaded.");
  } catch (error) {
    if (error.message !== "Unauthorized") {
      showToast(error.message);
    }
  }
}

function updateCharCount() {
  $("#charCount").textContent =
    `${$("#noteContent").value.length.toLocaleString()} characters`;
}

function cancelEditor() {
  if (state.editorDoneMode) {
    state.editorDoneMode = false;
    $("#noteTitle").readOnly = false;
    $("#noteContent").readOnly = false;
    $("#saveBtn").style.display = "";
    $("#cancelBtn").textContent = "Cancel";
  }

  showView(state.editorReturnView);
}

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = passwordInput.value;
  if (!password) return;

  loginError.textContent = "";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password })
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      throw new Error(body.error || "Wrong password or server unavailable.");
    }

    hideLogin();
    passwordInput.value = "";
    await loadRecent();
  } catch (error) {
    loginError.textContent = error.message || "Wrong password or server unavailable.";
  }
});

document.querySelectorAll("[data-view]").forEach(button => {
  button.addEventListener("click", () => showView(button.dataset.view));
});

$("#homeBtn").addEventListener("click", () => showView("home"));
$("#newNoteBtn").addEventListener("click", openNewNote);
$("#newNoteBtn2").addEventListener("click", openNewNote);
$("#saveBtn").addEventListener("click", saveNote);
$("#cancelBtn").addEventListener("click", cancelEditor);
$("#editorBack").addEventListener("click", cancelEditor);
$("#noteBack").addEventListener("click", () => showView("home"));
$("#editBtn").addEventListener("click", () => openEditorForNote(state.currentNote));
$("#deleteBtn").addEventListener("click", deleteCurrentNote);
$("#exportBtn").addEventListener("click", exportNotes);
themeToggle?.addEventListener("click", toggleTheme);

$("#noteCode").addEventListener("click", async () => {
  await navigator.clipboard?.writeText($("#noteCode").textContent);
  showToast("Code copied.");
});

$("#searchForm").addEventListener("submit", event => {
  event.preventDefault();

  const code = $("#searchInput").value.trim().toLowerCase();

  if (!NOTE_CODE_PATTERN.test(code)) {
    showToast(`Enter a ${NOTE_CODE_LENGTH}-character code.`);
    return;
  }

  openNote(code);
});

$("#sortSelect").addEventListener("change", loadAllNotes);
$("#listSearch").addEventListener("input", renderFilteredNotes);
$("#noteContent").addEventListener("input", updateCharCount);

$("#logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", {
    method: "POST",
    credentials: "same-origin"
  }).catch(() => {});

  location.reload();
});

async function initializeAuth() {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin"
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok && body.authenticated) {
      hideLogin();
      await loadRecent();
      return;
    }
  } catch {}

  showLogin();
}

applyTheme(getStoredTheme());
initializeAuth();
