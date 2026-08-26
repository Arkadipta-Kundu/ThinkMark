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
const FONT_SIZE_STORAGE_KEY = "thinkmark-font-size";
const DEFAULT_SORT_STORAGE_KEY = "thinkmark-default-sort";
const CONFIRM_DELETION_STORAGE_KEY = "thinkmark-confirm-deletion";
const NOTE_REFERENCE_PATTERN = /\[\[([a-z0-9]{4})\]\]/gi;
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
const OFFLINE_MESSAGE = "You're offline. Reconnect to fetch the latest notes.";

const passwordModal = $("#passwordModal");
const passwordForm = $("#passwordForm");
const passwordInput = $("#passwordInput");
const loginError = $("#loginError");
const themeToggle = $("#themeToggle");
const systemThemeQuery = window.matchMedia?.("(prefers-color-scheme: dark)");
const deleteModal = $("#deleteModal");
const deleteCancelBtn = $("#deleteCancelBtn");
const deleteConfirmBtn = $("#deleteConfirmBtn");
let pendingDeleteConfirmation = null;

function showLogin() {
  passwordModal.style.display = "grid";
  setTimeout(() => passwordInput.focus(), 100);
}

function hideLogin() {
  passwordModal.style.display = "none";
}

function isDeleteModalOpen() {
  return deleteModal && !deleteModal.hidden;
}

function closeDeleteModal(confirmed) {
  if (!pendingDeleteConfirmation) return;

  deleteModal.hidden = true;
  const resolve = pendingDeleteConfirmation;
  pendingDeleteConfirmation = null;
  resolve(confirmed);
}

function confirmNoteDeletion() {
  if (!deleteModal || !deleteCancelBtn || !deleteConfirmBtn) {
    return Promise.resolve(false);
  }

  return new Promise(resolve => {
    pendingDeleteConfirmation = resolve;
    deleteModal.hidden = false;
    deleteConfirmBtn.focus();
  });
}

function getStoredTheme() {
  try {
    const theme = localStorage.getItem(THEME_STORAGE_KEY);
    return theme === "dark" || theme === "light" || theme === "system" ? theme : "light";
  } catch {
    return "light";
  }
}

function getActiveTheme(theme) {
  if (theme === "system") {
    return systemThemeQuery?.matches ? "dark" : "light";
  }

  return theme === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  const themePreference = theme === "dark" || theme === "system" ? theme : "light";
  const activeTheme = getActiveTheme(themePreference);
  const themeConfig = THEMES[activeTheme];

  document.documentElement.dataset.theme = activeTheme;
  document.documentElement.dataset.themePreference = themePreference;
  $("#themeColorMeta")?.setAttribute("content", themeConfig.themeColor);
  themeToggle?.setAttribute("aria-label", themeConfig.label);
  themeToggle?.setAttribute("title", themeConfig.label);
  document
    .querySelectorAll("input[name='themePreference']")
    .forEach(input => {
      input.checked = input.value === themePreference;
    });
}

function toggleTheme() {
  const nextTheme = document.documentElement.dataset.theme === "dark"
    ? "light"
    : "dark";

  saveThemePreference(nextTheme);
}

function saveThemePreference(theme) {
  applyTheme(theme);

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch { }
}

function getStoredFontSize() {
  try {
    const fontSize = localStorage.getItem(FONT_SIZE_STORAGE_KEY);
    return fontSize === "small" || fontSize === "large" ? fontSize : "medium";
  } catch {
    return "medium";
  }
}

function applyFontSize(fontSize) {
  const activeFontSize = fontSize === "small" || fontSize === "large" ? fontSize : "medium";
  document.documentElement.dataset.fontSize = activeFontSize;
  document
    .querySelectorAll("input[name='fontSizePreference']")
    .forEach(input => {
      input.checked = input.value === activeFontSize;
    });
}

function saveFontSize(fontSize) {
  applyFontSize(fontSize);

  try {
    localStorage.setItem(FONT_SIZE_STORAGE_KEY, fontSize);
  } catch { }
}

function getStoredDefaultSort() {
  try {
    const sort = localStorage.getItem(DEFAULT_SORT_STORAGE_KEY);
    return sort === "oldest" || sort === "updated" ? sort : "newest";
  } catch {
    return "newest";
  }
}

function saveDefaultSort(sort) {
  const activeSort = sort === "oldest" || sort === "updated" ? sort : "newest";

  try {
    localStorage.setItem(DEFAULT_SORT_STORAGE_KEY, activeSort);
  } catch { }

  $("#sortSelect").value = activeSort;
}

function shouldConfirmDeletion() {
  try {
    return localStorage.getItem(CONFIRM_DELETION_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

function saveConfirmDeletion(value) {
  const activeValue = value === "off" ? "off" : "on";

  try {
    localStorage.setItem(CONFIRM_DELETION_STORAGE_KEY, activeValue);
  } catch { }

  document
    .querySelectorAll("input[name='confirmDeletionPreference']")
    .forEach(input => {
      input.checked = input.value === activeValue;
    });
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

function isOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

function showOfflineMessage() {
  showToast(OFFLINE_MESSAGE);
}

async function api(path, options = {}) {
  if (isOffline()) {
    throw new Error(OFFLINE_MESSAGE);
  }

  const response = await fetch(path, {
    ...options,
    cache: "no-store",
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

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" })
      .then((registration) => {
        registration.update().catch(() => { });

        if (registration.waiting) {
          registration.waiting.postMessage({ type: "SKIP_WAITING" });
        }

        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          if (!worker) return;

          worker.addEventListener("statechange", () => {
            if (worker.state === "installed" && navigator.serviceWorker.controller) {
              worker.postMessage({ type: "SKIP_WAITING" });
            }
          });
        });
      })
      .catch(() => { });
  });
}

function registerConnectionStatus() {
  window.addEventListener("offline", showOfflineMessage);
  window.addEventListener("online", () => {
    showToast("Back online. Fetching latest notes.");

    if (state.currentView === "home") loadRecent();
    if (state.currentView === "notes") loadAllNotes();
    if (state.currentView === "note" && state.currentNote?.code) {
      openNote(state.currentNote.code);
    }
  });
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
  if (viewName === "settings") loadSettingsStats();
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

function normalizeNoteCode(value) {
  return typeof value === "string" ? value.toLowerCase() : "";
}

function buildNoteIndex(notes) {
  return new Map(notes.map(note => [normalizeNoteCode(note.code), note]));
}

function extractNoteReferences(content) {
  const references = new Set();
  const pattern = new RegExp(NOTE_REFERENCE_PATTERN);
  let match;

  while ((match = pattern.exec(content)) !== null) {
    references.add(normalizeNoteCode(match[1]));
  }

  return references;
}

function noteLabel(note) {
  return note.title || note.code;
}

function sortNotes(notes, sort) {
  if (sort === "updated") {
    return [...notes].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  return notes;
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

function normalizeAutoLinkUrl(value) {
  const withProtocol = value.startsWith("www.") ? `https://${value}` : value;
  const normalized = withProtocol.replaceAll("&amp;", "&");
  return isSafeUrl(normalized) ? normalized : null;
}

function splitTrailingPunctuation(value) {
  let url = value;
  let trailing = "";

  while (/[.,!?;:\]]$/.test(url)) {
    trailing = url.slice(-1) + trailing;
    url = url.slice(0, -1);
  }

  while (url.endsWith(")")) {
    const opens = (url.match(/\(/g) || []).length;
    const closes = (url.match(/\)/g) || []).length;
    if (closes <= opens) break;

    trailing = ")" + trailing;
    url = url.slice(0, -1);
  }

  return { url, trailing };
}

function renderNoteReference(match, code, referenceIndex) {
  const normalizedCode = normalizeNoteCode(code);
  const referencedNote = referenceIndex.get(normalizedCode);

  if (!referencedNote) {
    return `<span class="note-reference unresolved">${escapeHtml(match)}</span>`;
  }

  const label = referencedNote.title
    ? `${referencedNote.title} (${referencedNote.code})`
    : referencedNote.code;

  return `<a class="note-reference" href="#${escapeAttribute(referencedNote.code)}" data-note-code="${escapeAttribute(referencedNote.code)}">→ ${escapeHtml(label)}</a>`;
}

function renderInlineMarkdown(text, referenceIndex = new Map()) {
  const codeParts = [];
  const markdownLinkParts = [];
  const placeholder = (index) => `\u0000CODE${index}\u0000`;
  const markdownLinkPlaceholder = (index) => `\u0000MDLINK${index}\u0000`;

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
    .replace(/<a\b[^>]*>.*?<\/a>/g, (link) => {
      const index = markdownLinkParts.push(link) - 1;
      return markdownLinkPlaceholder(index);
    })
    .replace(NOTE_REFERENCE_PATTERN, (match, code) => renderNoteReference(match, code, referenceIndex))
    .replace(/(^|[\s(])((?:https?:\/\/|www\.)[^\s<]+)/g, (match, lead, maybeUrl) => {
      const { url, trailing } = splitTrailingPunctuation(maybeUrl);
      const normalizedUrl = normalizeAutoLinkUrl(url);

      if (!normalizedUrl) return match;

      const anchor = `<a href="${escapeAttribute(normalizedUrl)}" target="_blank" rel="noopener noreferrer">${url}</a>`;
      return `${lead}${anchor}${trailing}`;
    })
    .replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n]+)\*/g, "$1<em>$2</em>");

  markdownLinkParts.forEach((link, index) => {
    html = html.replaceAll(markdownLinkPlaceholder(index), link);
  });

  codeParts.forEach((code, index) => {
    html = html.replaceAll(escapeHtml(placeholder(index)), code);
  });

  return html;
}

function renderMarkdown(markdown, referenceIndex = new Map()) {
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
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2].trim(), referenceIndex)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^\s*[-*]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*[-*]\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*[-*]\s+/, ""), referenceIndex)}</li>`);
        index += 1;
      }
      blocks.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items = [];
      while (index < lines.length && /^\s*\d+[.)]\s+/.test(lines[index])) {
        items.push(`<li>${renderInlineMarkdown(lines[index].replace(/^\s*\d+[.)]\s+/, ""), referenceIndex)}</li>`);
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
      blocks.push(`<blockquote><p>${renderInlineMarkdown(quoteLines.join(" "), referenceIndex)}</p></blockquote>`);
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

    blocks.push(`<p>${renderInlineMarkdown(paragraph.join(" "), referenceIndex)}</p>`);
  }

  return sanitizeRenderedMarkdown(blocks.join(""));
}

function sanitizeRenderedMarkdown(html) {
  const template = document.createElement("template");
  const allowedTags = new Set([
    "A", "BLOCKQUOTE", "CODE", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
    "LI", "OL", "P", "PRE", "SPAN", "STRONG", "UL"
  ]);
  const allowedAttributes = {
    A: new Set(["class", "data-note-code", "href", "rel", "target"]),
    SPAN: new Set(["class"])
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

    if (element.tagName === "A" && element.dataset.noteCode) {
      element.removeAttribute("target");
      element.removeAttribute("rel");
    } else if (element.tagName === "A" && element.getAttribute("href")) {
      element.setAttribute("target", "_blank");
      element.setAttribute("rel", "noopener noreferrer");
    }
  });

  return template.innerHTML;
}

function renderNoteTimestamps(note) {
  const createdAt = formatDateTime(note.created_at);
  const updatedAt = formatDateTime(note.updated_at);

  return `
    <span>Created: ${escapeHtml(createdAt)}</span>
    <span>Updated: ${escapeHtml(updatedAt)}</span>
  `;
}

function findBacklinks(currentCode, notes) {
  const normalizedCode = normalizeNoteCode(currentCode);

  return notes.filter(note => {
    const noteCode = normalizeNoteCode(note.code);
    return noteCode !== normalizedCode && extractNoteReferences(note.content).has(normalizedCode);
  });
}

function renderBacklinks(currentNote, notes) {
  const backlinks = findBacklinks(currentNote.code, notes);
  const container = $("#backlinks");

  if (!backlinks.length) {
    container.hidden = true;
    container.innerHTML = "";
    return;
  }

  container.hidden = false;
  container.innerHTML = `
    <h2>Referenced by</h2>
    <div class="backlink-list">
      ${backlinks.map(note => `
        <button class="backlink-row" data-code="${escapeHtml(note.code)}">
          <span class="backlink-code">→ ${escapeHtml(note.code)}</span>
          <span class="backlink-title">${escapeHtml(noteLabel(note))}</span>
        </button>
      `).join("")}
    </div>
  `;

  container.querySelectorAll(".backlink-row").forEach(row => {
    row.addEventListener("click", () => openNote(row.dataset.code));
  });
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
    const apiSort = sort === "oldest" ? "oldest" : "newest";
    const notes = await api(`/api/notes?sort=${apiSort}`);
    state.notes = sortNotes(notes, sort);
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
    const [note, notes] = await Promise.all([
      api(`/api/notes/${encodeURIComponent(code)}`),
      api("/api/notes?sort=newest")
    ]);
    const referenceIndex = buildNoteIndex(notes);

    state.notes = notes;
    state.currentNote = note;

    $("#noteCode").textContent = note.code;
    $("#noteTitleView").textContent = note.title || "";
    $("#noteTitleView").hidden = !note.title;
    $("#noteDate").innerHTML = renderNoteTimestamps(note);

    $("#noteContentView").innerHTML = renderMarkdown(note.content, referenceIndex);
    renderBacklinks(note, notes);

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
  if (isOffline()) {
    showOfflineMessage();
    return;
  }

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

  navigator.clipboard?.writeText(code).catch(() => { });
  showToast(`Your code is ${code}`);
}

async function deleteCurrentNote() {
  if (!state.currentNote) return;

  if (isOffline()) {
    showOfflineMessage();
    return;
  }

  const confirmed = !shouldConfirmDeletion() || await confirmNoteDeletion();

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
  if (isOffline()) {
    showOfflineMessage();
    return;
  }

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

function formatDateTime(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(date);
}

async function loadSettingsStats() {
  const totalNotes = $("#settingsTotalNotes");

  if (totalNotes) totalNotes.textContent = "Loading...";

  try {
    const notes = await api("/api/notes?sort=newest");
    state.notes = notes;
    if (totalNotes) totalNotes.textContent = notes.length.toLocaleString();
  } catch (error) {
    if (error.message !== "Unauthorized" && totalNotes) {
      totalNotes.textContent = error.message;
    }
  }
}

function initializeSettingsControls() {
  applyTheme(getStoredTheme());
  applyFontSize(getStoredFontSize());

  const defaultSort = getStoredDefaultSort();
  $("#sortSelect").value = defaultSort;
  $("#defaultSortSelect").value = defaultSort;
  saveConfirmDeletion(shouldConfirmDeletion() ? "on" : "off");

  document
    .querySelectorAll("input[name='themePreference']")
    .forEach(input => {
      input.addEventListener("change", () => saveThemePreference(input.value));
    });

  document
    .querySelectorAll("input[name='fontSizePreference']")
    .forEach(input => {
      input.addEventListener("change", () => saveFontSize(input.value));
    });

  document
    .querySelectorAll("input[name='confirmDeletionPreference']")
    .forEach(input => {
      input.addEventListener("change", () => saveConfirmDeletion(input.value));
    });

  $("#defaultSortSelect").addEventListener("change", () => {
    saveDefaultSort($("#defaultSortSelect").value);
    if (state.currentView === "notes") loadAllNotes();
  });
}

function isTypingTarget(target) {
  return Boolean(target?.closest?.("input, textarea, select, [contenteditable='true']"));
}

function canUseAppShortcuts(event) {
  return !isTypingTarget(event.target) && passwordModal.style.display === "none" && !isDeleteModalOpen();
}

function handleKeyboardShortcuts(event) {
  const key = event.key.toLowerCase();

  if ((event.ctrlKey || event.metaKey) && key === "s") {
    if (state.currentView !== "editor" || $("#saveBtn").disabled || $("#saveBtn").style.display === "none") {
      return;
    }

    event.preventDefault();
    saveNote();
    return;
  }

  if (key === "n" && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && canUseAppShortcuts(event)) {
    event.preventDefault();
    openNewNote();
  }
}

passwordForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const password = passwordInput.value;
  if (!password) return;

  loginError.textContent = "";

  try {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      cache: "no-store",
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
deleteCancelBtn?.addEventListener("click", () => closeDeleteModal(false));
deleteConfirmBtn?.addEventListener("click", () => closeDeleteModal(true));
deleteModal?.addEventListener("click", event => {
  if (event.target === deleteModal) closeDeleteModal(false);
});
$("#exportBtn")?.addEventListener("click", exportNotes);
themeToggle?.addEventListener("click", toggleTheme);
systemThemeQuery?.addEventListener("change", () => {
  if (getStoredTheme() === "system") applyTheme("system");
});

document.addEventListener("keydown", event => {
  if (event.key === "Escape" && isDeleteModalOpen()) {
    event.preventDefault();
    closeDeleteModal(false);
    return;
  }

  handleKeyboardShortcuts(event);
});

$("#noteCode").addEventListener("click", async () => {
  await navigator.clipboard?.writeText($("#noteCode").textContent);
  showToast("Code copied.");
});

$("#noteContentView").addEventListener("click", event => {
  const reference = event.target.closest("[data-note-code]");

  if (!reference) return;

  event.preventDefault();
  openNote(reference.dataset.noteCode);
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
    cache: "no-store",
    credentials: "same-origin"
  }).catch(() => { });

  location.reload();
});

async function initializeAuth() {
  try {
    if (isOffline()) {
      showLogin();
      loginError.textContent = OFFLINE_MESSAGE;
      return;
    }

    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin"
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok && body.authenticated) {
      hideLogin();
      await loadRecent();
      return;
    }
  } catch { }

  showLogin();
}

initializeSettingsControls();
registerServiceWorker();
registerConnectionStatus();
initializeAuth();
