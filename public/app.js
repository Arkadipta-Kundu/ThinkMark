const state = {
  authState: "AUTH_LOADING",
  currentView: "home",
  currentNote: null,
  editingCode: null,
  editorDoneMode: false,
  editorReturnView: "home",
  notes: [],
  notesLoaded: false,
  selectedTag: null
};

const NOTE_CODE_LENGTH = 4;
const NOTE_CODE_PATTERN = new RegExp(`^[a-z0-9]{${NOTE_CODE_LENGTH}}$`);
const THEME_STORAGE_KEY = "thinkmark-theme";
const FONT_SIZE_STORAGE_KEY = "thinkmark-font-size";
const NOTE_FONT_SIZE_STORAGE_KEY = "thinkmark-note-font-size";
const DEFAULT_SORT_STORAGE_KEY = "thinkmark-default-sort";
const CONFIRM_DELETION_STORAGE_KEY = "thinkmark-confirm-deletion";
const AUTOSAVE_STORAGE_PREFIX = "thinkmark.editor";
const AUTOSAVE_NEW_NOTE_KEY = `${AUTOSAVE_STORAGE_PREFIX}.new`;
const AUTOSAVE_VERSION = 1;
const AUTOSAVE_DEBOUNCE_MS = 750;
const NOTE_REFERENCE_PATTERN = /\[\[([a-z0-9]{4})\]\]/gi;
const TAG_PATTERN = /^[a-z0-9][a-z0-9_-]{0,39}$/;
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
const AUTH_STATES = {
  LOADING: "AUTH_LOADING",
  AUTHENTICATED: "AUTHENTICATED",
  UNAUTHENTICATED: "UNAUTHENTICATED"
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
const deleteModalTitle = $("#deleteModalTitle");
const deleteModalMessage = $("#deleteModalMessage");
const deleteCancelBtn = $("#deleteCancelBtn");
const deleteConfirmBtn = $("#deleteConfirmBtn");
let pendingDeleteConfirmation = null;
let pendingDeleteCancelHandler = null;
let noteListRequest = null;
let autosaveTimer = null;
let autosaveStatusTimer = null;
let recoveryAcknowledgedKey = null;

function setAuthState(authState) {
  state.authState = authState;
  document.body.dataset.authState = authState
    .replace("AUTH_", "")
    .toLowerCase();
}

function resetPrivateState() {
  state.currentNote = null;
  state.editingCode = null;
  state.editorDoneMode = false;
  state.editorReturnView = "home";
  state.notes = [];
  state.notesLoaded = false;
  state.selectedTag = null;
  noteListRequest = null;

  $("#recentList").innerHTML = `<div class="empty-state">No notes yet.</div>`;
  $("#allNotesList").innerHTML = `<div class="empty-state">No notes yet.</div>`;
  $("#tagFilters").innerHTML = "";
  $("#tagFilters").hidden = true;
  $("#settingsTotalNotes").textContent = "0";
  $("#noteContentView").innerHTML = "";
  $("#noteTitleView").textContent = "";
  $("#noteTitleView").hidden = true;
  $("#noteDate").textContent = "";
  $("#noteTagsView").innerHTML = "";
  $("#noteTagsView").hidden = true;
  $("#backlinks").hidden = true;
  $("#backlinks").innerHTML = "";
}

function showAuthenticatedApp() {
  hideLogin();
  setAuthState(AUTH_STATES.AUTHENTICATED);
}

function showUnauthenticatedApp(message = "") {
  resetPrivateState();
  setAuthState(AUTH_STATES.UNAUTHENTICATED);
  showView("home");
  showLogin();
  loginError.textContent = message;
}

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

function isLoginModalOpen() {
  return passwordModal?.style.display !== "none";
}

function isModalOpen() {
  return isLoginModalOpen() || isDeleteModalOpen();
}

function closeDeleteModal(confirmed) {
  if (!pendingDeleteConfirmation) return;

  deleteModal.hidden = true;
  const resolve = pendingDeleteConfirmation;
  pendingDeleteConfirmation = null;
  pendingDeleteCancelHandler = null;
  resolve(confirmed);
}

function configureDeleteModal(options = {}) {
  if (deleteModalTitle) deleteModalTitle.textContent = options.title || "Delete note?";
  if (deleteModalMessage) deleteModalMessage.textContent = options.message || "This action cannot be undone.";
  if (deleteCancelBtn) deleteCancelBtn.textContent = options.cancelLabel || "Cancel";
  if (deleteConfirmBtn) deleteConfirmBtn.textContent = options.confirmLabel || "Delete";
}

function confirmWithDeleteModal(options = {}) {
  if (!deleteModal || !deleteCancelBtn || !deleteConfirmBtn) {
    return Promise.resolve(false);
  }

  configureDeleteModal(options);

  return new Promise(resolve => {
    pendingDeleteConfirmation = resolve;
    pendingDeleteCancelHandler = typeof options.onCancel === "function" ? options.onCancel : null;
    deleteModal.hidden = false;
    deleteConfirmBtn.focus();
  });
}

function confirmNoteDeletion() {
  return confirmWithDeleteModal({
    title: "Delete note?",
    message: "This action cannot be undone.",
    confirmLabel: "Delete"
  });
}

function confirmRecoveryDraftDiscard(onCancel) {
  return confirmWithDeleteModal({
    title: "Discard unsaved note?",
    message: "This locally saved version will be permanently removed.",
    cancelLabel: "Continue writing",
    confirmLabel: "Discard",
    onCancel
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

function getActiveNoteFontSize(fontSize) {
  return fontSize === "small" || fontSize === "large" || fontSize === "extra-large"
    ? fontSize
    : "medium";
}

function getStoredNoteFontSize() {
  try {
    return getActiveNoteFontSize(localStorage.getItem(NOTE_FONT_SIZE_STORAGE_KEY));
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

function applyNoteFontSize(fontSize) {
  const activeFontSize = getActiveNoteFontSize(fontSize);
  document.documentElement.dataset.noteFontSize = activeFontSize;
  document
    .querySelectorAll("input[name='noteFontSizePreference']")
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

function saveNoteFontSize(fontSize) {
  const activeFontSize = getActiveNoteFontSize(fontSize);
  applyNoteFontSize(activeFontSize);

  try {
    localStorage.setItem(NOTE_FONT_SIZE_STORAGE_KEY, activeFontSize);
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

function getAutosaveStatus() {
  return $("#autosaveStatus");
}

function setAutosaveStatus(message) {
  const status = getAutosaveStatus();
  if (!status) return;

  clearTimeout(autosaveStatusTimer);
  status.textContent = message;

  if (message === "Saved locally") {
    autosaveStatusTimer = setTimeout(() => {
      if (status.textContent === message) status.textContent = "";
    }, 4000);
  }
}

function hideAutosaveRecovery() {
  const recovery = $("#autosaveRecovery");
  if (recovery) recovery.hidden = true;
}

function clearAutosaveRecoveryState(key) {
  removeAutosaveDraft(key);

  const recovery = $("#autosaveRecovery");
  if (recovery?.dataset.key === key) {
    delete recovery.dataset.key;
    hideAutosaveRecovery();
  }

  if (recoveryAcknowledgedKey === key) {
    recoveryAcknowledgedKey = null;
  }
}

function getEditorAutosaveKey(code = state.editingCode) {
  const normalizedCode = normalizeNoteCode(code);
  return normalizedCode
    ? `${AUTOSAVE_STORAGE_PREFIX}.note.${normalizedCode}`
    : AUTOSAVE_NEW_NOTE_KEY;
}

function hasMeaningfulEditorState(title, content) {
  return Boolean(String(title || "").trim() || String(content || "").trim());
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function readAutosaveDraft(key) {
  try {
    const draft = safeJsonParse(localStorage.getItem(key));

    if (
      !draft ||
      draft.version !== AUTOSAVE_VERSION ||
      (draft.type !== "new" && draft.type !== "edit") ||
      typeof draft.title !== "string" ||
      typeof draft.content !== "string"
    ) {
      return null;
    }

    draft.tags = normalizeTags(draft.tags || []);

    if (!hasMeaningfulEditorState(draft.title, draft.content)) {
      localStorage.removeItem(key);
      return null;
    }

    return draft;
  } catch {
    return null;
  }
}

function removeAutosaveDraft(key = getEditorAutosaveKey()) {
  try {
    localStorage.removeItem(key);
  } catch { }
}

function getCurrentEditorDraft() {
  const editingCode = normalizeNoteCode(state.editingCode);
  const note = editingCode ? findNoteInState(editingCode) || state.currentNote : null;

  return {
    version: AUTOSAVE_VERSION,
    type: editingCode ? "edit" : "new",
    code: editingCode || null,
    title: $("#noteTitle").value,
    content: $("#noteContent").value,
    tags: readEditorTags(),
    savedAt: new Date().toISOString(),
    baseUpdatedAt: editingCode ? note?.updated_at || null : null
  };
}

function writeCurrentEditorDraft(options = {}) {
  if (state.currentView !== "editor" || state.editorDoneMode) return;

  const draft = getCurrentEditorDraft();
  const key = getEditorAutosaveKey(draft.code);

  if (!hasMeaningfulEditorState(draft.title, draft.content)) {
    removeAutosaveDraft(key);
    if (!options.silent) setAutosaveStatus("");
    return;
  }

  try {
    localStorage.setItem(key, JSON.stringify(draft));
    if (!options.silent) setAutosaveStatus("Saved locally");
  } catch {
    if (!options.silent) setAutosaveStatus("Local save unavailable");
  }
}

function flushPendingAutosave(options = {}) {
  clearTimeout(autosaveTimer);
  autosaveTimer = null;
  writeCurrentEditorDraft(options);
}

function scheduleAutosave() {
  if (state.currentView !== "editor" || state.editorDoneMode) return;

  clearTimeout(autosaveTimer);

  if (!hasMeaningfulEditorState($("#noteTitle").value, $("#noteContent").value)) {
    removeAutosaveDraft();
    setAutosaveStatus("");
    return;
  }

  setAutosaveStatus("Saving locally...");
  autosaveTimer = setTimeout(writeCurrentEditorDraft, AUTOSAVE_DEBOUNCE_MS);
}

function draftsMatchEditor(draft) {
  return draft?.title === $("#noteTitle").value &&
    draft?.content === $("#noteContent").value &&
    tagsEqual(draft.tags || [], readEditorTags());
}

function getAutosaveRecoveryMessage(draft, note) {
  if (draft?.type === "edit" && note?.updated_at && draft.baseUpdatedAt !== note.updated_at) {
    return "Local changes were saved before the latest server version.";
  }

  return "Continue writing or discard it.";
}

function showAutosaveRecovery(draft, options = {}) {
  const recovery = $("#autosaveRecovery");
  const meta = $("#autosaveRecoveryMeta");

  if (!recovery || !draft) return;

  recovery.dataset.key = options.key || getEditorAutosaveKey(draft.code);
  meta.textContent = getAutosaveRecoveryMessage(draft, options.note);
  recovery.hidden = false;
}

function checkEditorRecovery(options = {}) {
  const key = options.key || getEditorAutosaveKey();
  const draft = readAutosaveDraft(key);

  if (!draft) {
    hideAutosaveRecovery();
    return;
  }

  if (recoveryAcknowledgedKey === key) {
    hideAutosaveRecovery();
    return;
  }

  const editingCode = normalizeNoteCode(state.editingCode);
  const draftCode = normalizeNoteCode(draft.code);
  const belongsToEditor = editingCode
    ? draft.type === "edit" && draftCode === editingCode
    : draft.type === "new" && !draftCode;

  if (!belongsToEditor) {
    hideAutosaveRecovery();
    return;
  }

  if (draftsMatchEditor(draft)) {
    hideAutosaveRecovery();
    setAutosaveStatus("Saved locally");
    return;
  }

  const note = options.note || null;

  if (
    draft.type === "edit" &&
    note &&
    draft.title === (note.title || "") &&
    draft.content === note.content &&
    tagsEqual(draft.tags || [], note.tags || [])
  ) {
    removeAutosaveDraft(key);
    hideAutosaveRecovery();
    return;
  }

  showAutosaveRecovery(draft, { key, note });
}

function restoreAutosaveDraft() {
  const recovery = $("#autosaveRecovery");
  const key = recovery?.dataset.key || getEditorAutosaveKey();
  const draft = readAutosaveDraft(key);

  if (!draft) {
    hideAutosaveRecovery();
    return;
  }

  $("#noteTitle").value = draft.title;
  $("#noteContent").value = draft.content;
  $("#noteTags").value = formatTagsForInput(draft.tags);
  updateTagPreview();
  updateCharCount();
  recoveryAcknowledgedKey = key;
  hideAutosaveRecovery();
  setAutosaveStatus("Saved locally");
  $("#noteTitle").focus();
}

async function confirmAndDiscardAutosaveDraft() {
  const confirmed = await confirmRecoveryDraftDiscard(restoreAutosaveDraft);

  if (!confirmed) {
    return;
  }

  discardAutosaveDraft();
}

function discardAutosaveDraft() {
  const recovery = $("#autosaveRecovery");
  const key = recovery?.dataset.key || getEditorAutosaveKey();

  removeAutosaveDraft(key);
  hideAutosaveRecovery();
  setAutosaveStatus("");
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
    showUnauthenticatedApp();
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

    if (state.currentView === "home") loadRecent({ force: true });
    if (state.currentView === "notes") loadAllNotes({ force: true });
    if (state.currentView === "note" && state.currentNote?.code) {
      openNote(state.currentNote.code, { force: true });
    }
  });
}

function showView(viewName, options = {}) {
  if (state.currentView === "editor" && viewName !== "editor" && !options.skipAutosaveFlush) {
    flushPendingAutosave({ silent: true });
  }

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

  if (state.authState !== AUTH_STATES.AUTHENTICATED) return;

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

function compactText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function normalizeTitle(value) {
  if (typeof value !== "string") return null;

  const title = value.trim();
  return title || null;
}

function normalizeTag(value) {
  if (typeof value !== "string") return null;

  const tag = value.trim().replace(/^#+/, "").toLowerCase();
  return TAG_PATTERN.test(tag) ? tag : null;
}

function normalizeTags(value) {
  const rawTags = Array.isArray(value)
    ? value
    : String(value || "").split(/[\s,]+/);
  const tags = [];
  const seen = new Set();

  rawTags.forEach(rawTag => {
    const tag = normalizeTag(rawTag);
    if (!tag || seen.has(tag)) return;

    seen.add(tag);
    tags.push(tag);
  });

  return tags;
}

function readEditorTags() {
  return normalizeTags($("#noteTags")?.value || "");
}

function formatTagsForInput(tags) {
  return normalizeTags(tags).map(tag => `#${tag}`).join(" ");
}

function tagsEqual(left, right) {
  const leftTags = normalizeTags(left);
  const rightTags = normalizeTags(right);
  return leftTags.length === rightTags.length && leftTags.every((tag, index) => tag === rightTags[index]);
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
  return normalizeTitle(note.title) || preview(note.content) || note.code;
}

function noteCardDisplayText(note) {
  return preview(normalizeTitle(note.title) || note.content);
}

function normalizeNote(note) {
  return {
    ...note,
    title: normalizeTitle(note?.title),
    tags: normalizeTags(note?.tags || [])
  };
}

function noteMatchesTag(note, tag) {
  return !tag || normalizeTags(note.tags).includes(tag);
}

function buildTagCounts(notes) {
  const counts = new Map();

  notes.forEach(note => {
    normalizeTags(note.tags).forEach(tag => {
      counts.set(tag, (counts.get(tag) || 0) + 1);
    });
  });

  return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
}

function parseSearchQuery(query) {
  const tokens = [];
  const pattern = /"([^"]+)"|(\S+)/g;
  let match;

  while ((match = pattern.exec(query.trim())) !== null) {
    const value = compactText(match[1] || match[2]).toLowerCase();
    if (!value) continue;
    tokens.push({ value, phrase: Boolean(match[1]) || value.includes(" ") });
  }

  return tokens;
}

function findFirstMatchIndex(text, tokens) {
  const lowerText = String(text || "").toLowerCase();
  let firstIndex = -1;

  tokens.forEach(token => {
    const index = lowerText.indexOf(token.value);
    if (index === -1) return;
    if (firstIndex === -1 || index < firstIndex) firstIndex = index;
  });

  return firstIndex;
}

function noteSearchResult(note, query) {
  const tokens = parseSearchQuery(query);
  if (!tokens.length) return { note, score: 0, titleMatched: false, contentIndex: -1, tokens };

  const title = note.title || "";
  const content = note.content || "";
  const searchText = `${title}\n${content}`.toLowerCase();
  const matches = tokens.every(token => searchText.includes(token.value));

  if (!matches) return null;

  const titleMatched = tokens.some(token => title.toLowerCase().includes(token.value));
  const contentIndex = findFirstMatchIndex(content, tokens);
  const exactQuery = compactText(query.replace(/^"|"$/g, "")).toLowerCase();
  const exactPhraseMatched = exactQuery && searchText.includes(exactQuery);
  const phraseMatches = tokens.filter(token => token.phrase).length;
  const score = (exactPhraseMatched ? 40 : 0) + (phraseMatches * 10) + (titleMatched ? 6 : 0);

  return { note, score, titleMatched, contentIndex, tokens };
}

function getSearchResults(notes, query) {
  const results = notes
    .map(note => noteSearchResult(note, query))
    .filter(Boolean);

  return results.sort((a, b) => b.score - a.score || new Date(b.note.created_at) - new Date(a.note.created_at));
}

function highlightText(text, tokens) {
  const source = String(text || "");
  const values = [...new Set(tokens.map(token => token.value).filter(Boolean))]
    .sort((a, b) => b.length - a.length);

  if (!values.length) return escapeHtml(source);

  const lowerSource = source.toLowerCase();
  const ranges = [];

  values.forEach(value => {
    let start = 0;
    while (start < lowerSource.length) {
      const index = lowerSource.indexOf(value, start);
      if (index === -1) break;
      ranges.push([index, index + value.length]);
      start = index + Math.max(value.length, 1);
    }
  });

  const merged = ranges
    .sort((a, b) => a[0] - b[0] || b[1] - a[1])
    .reduce((items, range) => {
      const last = items[items.length - 1];
      if (!last || range[0] > last[1]) {
        items.push(range);
      } else {
        last[1] = Math.max(last[1], range[1]);
      }
      return items;
    }, []);

  let html = "";
  let cursor = 0;

  merged.forEach(([start, end]) => {
    html += escapeHtml(source.slice(cursor, start));
    html += `<mark>${escapeHtml(source.slice(start, end))}</mark>`;
    cursor = end;
  });

  return html + escapeHtml(source.slice(cursor));
}

function searchSnippet(note, result) {
  const content = compactText(note.content);
  if (!content) return "";

  const index = result?.contentIndex ?? -1;
  if (index === -1) return preview(content);

  const start = Math.max(0, index - 48);
  const end = Math.min(content.length, index + 112);
  const prefix = start > 0 ? "... " : "";
  const suffix = end < content.length ? " ..." : "";

  return `${prefix}${content.slice(start, end)}${suffix}`;
}

function sortNotes(notes, sort) {
  if (sort === "oldest") {
    return [...notes].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }

  if (sort === "updated") {
    return [...notes].sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  }

  return [...notes].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

function noteHasCompleteData(note) {
  return Boolean(
    note &&
    typeof note.code === "string" &&
    typeof note.content === "string" &&
    typeof note.created_at === "string" &&
    typeof note.updated_at === "string"
  );
}

function findNoteInState(code) {
  const normalizedCode = normalizeNoteCode(code);
  return state.notes.find(note => normalizeNoteCode(note.code) === normalizedCode);
}

function setNotes(notes) {
  state.notes = Array.isArray(notes) ? notes.filter(noteHasCompleteData).map(normalizeNote) : [];
  state.notesLoaded = true;
  renderTagFilters();
}

function upsertNoteInState(note) {
  if (!noteHasCompleteData(note)) return false;

  const normalizedNote = normalizeNote(note);
  const normalizedCode = normalizeNoteCode(normalizedNote.code);
  const index = state.notes.findIndex(existing => normalizeNoteCode(existing.code) === normalizedCode);

  if (index === -1) {
    state.notes = [normalizedNote, ...state.notes];
  } else {
    state.notes = [
      ...state.notes.slice(0, index),
      normalizedNote,
      ...state.notes.slice(index + 1)
    ];
  }

  renderTagFilters();
  return true;
}

function removeNoteFromState(code) {
  const normalizedCode = normalizeNoteCode(code);
  state.notes = state.notes.filter(note => normalizeNoteCode(note.code) !== normalizedCode);
  if (state.selectedTag && !buildTagCounts(state.notes).some(([tag]) => tag === state.selectedTag)) {
    state.selectedTag = null;
  }
  renderTagFilters();
}

function getNotesForSort(sort) {
  return sortNotes(state.notes, sort);
}

function renderCurrentNote(note) {
  const referenceIndex = buildNoteIndex(state.notes);
  const normalizedNote = normalizeNote(note);

  state.currentNote = normalizedNote;

  $("#noteCode").textContent = normalizedNote.code;
  $("#noteTitleView").textContent = normalizedNote.title || "";
  $("#noteTitleView").hidden = !normalizedNote.title;
  $("#noteDate").innerHTML = renderNoteTimestamps(normalizedNote);
  renderNoteTags(normalizedNote.tags, $("#noteTagsView"), { clickable: true });

  $("#noteContentView").innerHTML = renderMarkdown(normalizedNote.content, referenceIndex);
  renderBacklinks(normalizedNote, state.notes);
}

async function loadNoteList(sort = "newest", options = {}) {
  if (!options.force && state.notesLoaded) {
    return getNotesForSort(sort);
  }

  if (noteListRequest) {
    return noteListRequest.then(() => getNotesForSort(sort));
  }

  const apiSort = sort === "oldest" ? "oldest" : "newest";

  noteListRequest = api(`/api/notes?sort=${apiSort}`)
    .then(notes => {
      setNotes(notes);
      return getNotesForSort(sort);
    })
    .finally(() => {
      noteListRequest = null;
    });

  return noteListRequest;
}

function renderTagChips(tags, options = {}) {
  const className = options.active ? "tag-chip active" : "tag-chip";
  return normalizeTags(tags)
    .map(tag => `<span class="${className}" data-tag="${escapeAttribute(tag)}">#${escapeHtml(tag)}</span>`)
    .join("");
}

function renderNoteTags(tags, container, options = {}) {
  const normalizedTags = normalizeTags(tags);
  if (!container) return;

  container.hidden = normalizedTags.length === 0;
  container.innerHTML = normalizedTags
    .map(tag => {
      const attrs = options.clickable ? ` role="button" tabindex="0" data-tag="${escapeAttribute(tag)}"` : "";
      return `<span class="tag-chip"${attrs}>#${escapeHtml(tag)}</span>`;
    })
    .join("");
}

function renderTagFilters() {
  const container = $("#tagFilters");
  if (!container) return;

  const tags = buildTagCounts(state.notes);
  container.hidden = tags.length === 0;
  container.innerHTML = tags.map(([tag, count]) => `
    <button class="tag-filter${state.selectedTag === tag ? " active" : ""}" data-tag="${escapeAttribute(tag)}">
      #${escapeHtml(tag)} <span>${count}</span>
    </button>
  `).join("");

  container.querySelectorAll(".tag-filter").forEach(button => {
    button.addEventListener("click", () => {
      state.selectedTag = state.selectedTag === button.dataset.tag ? null : button.dataset.tag;
      renderFilteredNotes();
      renderTagFilters();
    });
  });
}

function renderNoteRows(notes, container, options = {}) {
  if (!notes.length) {
    container.innerHTML = `<div class="empty-state">${escapeHtml(options.emptyMessage || "No notes yet.")}</div>`;
    return;
  }

  container.innerHTML = notes.map(item => {
    const note = item.note || item;
    const result = item.note ? item : null;
    const label = noteLabel(note);
    const snippet = result ? searchSnippet(note, result) : noteCardDisplayText(note);
    const tokens = result?.tokens || [];
    const titleHtml = result ? highlightText(label, tokens) : escapeHtml(label);
    const snippetHtml = result ? highlightText(snippet, tokens) : escapeHtml(snippet);
    const tagsHtml = renderTagChips(note.tags);

    return `
    <button class="note-row${result ? " search-result" : ""}" data-code="${escapeHtml(note.code)}">
      <span class="row-code">${escapeHtml(note.code)}</span>
      <span class="row-main">
        <span class="row-title">${titleHtml}</span>
        <span class="row-preview">${snippetHtml}</span>
        ${tagsHtml ? `<span class="row-tags">${tagsHtml}</span>` : ""}
      </span>
      <span class="row-date">${formatDate(note.created_at)}</span>
    </button>
  `;
  }).join("");

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
    .replace(/\*\*\*([^*\n](?:.*?[^*\n])?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*([^*\n](?:.*?[^*\n])?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^\*])\*([^*\n](?:.*?[^*\n])?)\*/g, "$1<em>$2</em>")
    .replace(/~~([^~\n](?:.*?[^~\n])?)~~/g, "<del>$1</del>");

  markdownLinkParts.forEach((link, index) => {
    html = html.replaceAll(markdownLinkPlaceholder(index), link);
  });

  codeParts.forEach((code, index) => {
    html = html.replaceAll(escapeHtml(placeholder(index)), code);
  });

  return html;
}

function getIndent(line) {
  return (line.match(/^\s*/) || [""])[0].replace(/\t/g, "    ").length;
}

function matchListItem(line) {
  const match = line.match(/^(\s*)([-*+]|\d+[.)])\s+(.+)$/);
  if (!match) return null;

  return {
    indent: getIndent(match[1]),
    ordered: /^\d/.test(match[2]),
    content: match[3]
  };
}

function isBlockStart(line) {
  return (
    !line.trim() ||
    line.trimStart().startsWith("```") ||
    /^(#{1,6})\s+/.test(line) ||
    /^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line) ||
    /^\s*>\s?/.test(line) ||
    Boolean(matchListItem(line)) ||
    isTableStart(line)
  );
}

function renderParagraph(lines, referenceIndex) {
  const parts = [];

  lines.forEach((line, index) => {
    const hardBreak = /(?: {2,}|\\)$/.test(line);
    const content = line.replace(/(?: {2,}|\\)$/, "").trim();

    if (content) parts.push(renderInlineMarkdown(content, referenceIndex));
    if (hardBreak && index < lines.length - 1) parts.push("<br>");
    else if (index < lines.length - 1) parts.push(" ");
  });

  return `<p>${parts.join("")}</p>`;
}

function renderList(lines, startIndex, referenceIndex) {
  const firstItem = matchListItem(lines[startIndex]);
  const baseIndent = firstItem.indent;
  const ordered = firstItem.ordered;
  const tag = ordered ? "ol" : "ul";
  const items = [];
  let index = startIndex;

  while (index < lines.length) {
    const item = matchListItem(lines[index]);
    if (!item || item.indent < baseIndent || item.ordered !== ordered) break;

    if (item.indent > baseIndent) {
      if (!items.length) break;
      const nested = renderList(lines, index, referenceIndex);
      items[items.length - 1] = items[items.length - 1].replace("</li>", `${nested.html}</li>`);
      index = nested.nextIndex;
      continue;
    }

    const itemParts = [renderInlineMarkdown(item.content.trim(), referenceIndex)];
    index += 1;

    while (index < lines.length) {
      const nextItem = matchListItem(lines[index]);

      if (nextItem) {
        if (nextItem.indent > baseIndent) {
          const nested = renderList(lines, index, referenceIndex);
          itemParts.push(nested.html);
          index = nested.nextIndex;
          continue;
        }

        break;
      }

      if (!lines[index].trim()) {
        const afterBlank = matchListItem(lines[index + 1] || "");
        if (!afterBlank || afterBlank.indent < baseIndent) break;
        index += 1;
        continue;
      }

      if (isBlockStart(lines[index])) break;
      itemParts.push(` ${renderInlineMarkdown(lines[index].trim(), referenceIndex)}`);
      index += 1;
    }

    items.push(`<li>${itemParts.join("")}</li>`);
  }

  return { html: `<${tag}>${items.join("")}</${tag}>`, nextIndex: index };
}

function splitTableRow(line) {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|")) row = row.slice(0, -1);
  return row.split("|").map(cell => cell.trim());
}

function parseTableAlignment(line) {
  const cells = splitTableRow(line);
  if (!cells.length) return null;

  const alignments = [];
  for (const cell of cells) {
    if (!/^:?-{3,}:?$/.test(cell)) return null;
    const left = cell.startsWith(":");
    const right = cell.endsWith(":");
    alignments.push(left && right ? "center" : right ? "right" : left ? "left" : "");
  }

  return alignments;
}

function isTableStart(line, nextLine = "") {
  return line.includes("|") && Boolean(parseTableAlignment(nextLine));
}

function renderTable(lines, startIndex, referenceIndex) {
  const headers = splitTableRow(lines[startIndex]);
  const alignments = parseTableAlignment(lines[startIndex + 1]);
  const rows = [];
  let index = startIndex + 2;

  while (index < lines.length && lines[index].trim() && lines[index].includes("|")) {
    rows.push(splitTableRow(lines[index]));
    index += 1;
  }

  const alignmentAttribute = (columnIndex) => {
    const alignment = alignments[columnIndex];
    return alignment ? ` style="text-align: ${alignment}"` : "";
  };
  const renderCells = (cells, tag) => headers.map((_, columnIndex) => {
    const content = cells[columnIndex] || "";
    return `<${tag}${alignmentAttribute(columnIndex)}>${renderInlineMarkdown(content, referenceIndex)}</${tag}>`;
  }).join("");

  return {
    html: `<div class="table-wrap"><table><thead><tr>${renderCells(headers, "th")}</tr></thead><tbody>${rows.map(row => `<tr>${renderCells(row, "td")}</tr>`).join("")}</tbody></table></div>`,
    nextIndex: index
  };
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

    const fence = line.trimStart().match(/^```([A-Za-z0-9_-]+)?\s*$/);
    if (fence) {
      const codeLines = [];
      const language = fence[1] ? ` class="language-${escapeAttribute(fence[1])}"` : "";
      index += 1;

      while (index < lines.length && !lines[index].trimStart().startsWith("```")) {
        codeLines.push(lines[index]);
        index += 1;
      }

      if (index < lines.length) index += 1;
      blocks.push(`<pre><code${language}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      blocks.push(`<h${level}>${renderInlineMarkdown(heading[2].trim(), referenceIndex)}</h${level}>`);
      index += 1;
      continue;
    }

    if (/^ {0,3}([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      blocks.push("<hr>");
      index += 1;
      continue;
    }

    if (isTableStart(line, lines[index + 1] || "")) {
      const table = renderTable(lines, index, referenceIndex);
      blocks.push(table.html);
      index = table.nextIndex;
      continue;
    }

    if (matchListItem(line)) {
      const list = renderList(lines, index, referenceIndex);
      blocks.push(list.html);
      index = list.nextIndex;
      continue;
    }

    if (/^\s*>\s?/.test(line)) {
      const quoteLines = [];
      while (index < lines.length && (/^\s*>\s?/.test(lines[index]) || !lines[index].trim())) {
        quoteLines.push(lines[index].replace(/^\s*>\s?/, ""));
        index += 1;
      }
      blocks.push(`<blockquote>${renderMarkdown(quoteLines.join("\n"), referenceIndex)}</blockquote>`);
      continue;
    }

    const paragraph = [];
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }

    blocks.push(renderParagraph(paragraph, referenceIndex));
  }

  return sanitizeRenderedMarkdown(blocks.join(""));
}

function sanitizeRenderedMarkdown(html) {
  const template = document.createElement("template");
  const allowedTags = new Set([
    "A", "BLOCKQUOTE", "BR", "CODE", "DEL", "DIV", "EM", "H1", "H2", "H3", "H4", "H5", "H6",
    "HR", "LI", "OL", "P", "PRE", "SPAN", "STRONG", "TABLE", "TBODY", "TD", "TH", "THEAD", "TR", "UL"
  ]);
  const allowedAttributes = {
    A: new Set(["class", "data-note-code", "href", "rel", "target"]),
    CODE: new Set(["class"]),
    DIV: new Set(["class"]),
    TD: new Set(["style"]),
    TH: new Set(["style"]),
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

    if (
      ["TD", "TH"].includes(element.tagName) &&
      element.getAttribute("style") &&
      !/^text-align:\s*(left|center|right);?$/i.test(element.getAttribute("style"))
    ) {
      element.removeAttribute("style");
    }

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

async function loadRecent(options = {}) {
  try {
    const notes = await loadNoteList("newest", options);
    renderNoteRows(notes.slice(0, 5), $("#recentList"));
  } catch (error) {
    if (error.message !== "Unauthorized") {
      $("#recentList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

async function loadAllNotes(options = {}) {
  if (!state.notesLoaded || options.force) {
    $("#allNotesList").innerHTML = `<div class="empty-state">Loading...</div>`;
  }

  try {
    const sort = $("#sortSelect").value;
    await loadNoteList(sort, options);
    renderFilteredNotes();
  } catch (error) {
    if (error.message !== "Unauthorized") {
      $("#allNotesList").innerHTML = `<div class="empty-state">${escapeHtml(error.message)}</div>`;
    }
  }
}

function renderFilteredNotes() {
  const query = $("#listSearch").value.trim();
  const notes = getNotesForSort($("#sortSelect").value)
    .filter(note => noteMatchesTag(note, state.selectedTag));

  if (!query) {
    renderNoteRows(notes, $("#allNotesList"), {
      emptyMessage: state.selectedTag ? `No notes tagged #${state.selectedTag}.` : "No notes yet."
    });
    return;
  }

  const results = getSearchResults(notes, query);
  renderNoteRows(results, $("#allNotesList"), {
    emptyMessage: state.selectedTag
      ? `No matches in #${state.selectedTag}.`
      : "No matching notes."
  });
}

async function openNote(code, options = {}) {
  try {
    const cachedNote = options.force ? null : findNoteInState(code);
    let note = noteHasCompleteData(cachedNote) ? cachedNote : null;

    if (!note && state.notesLoaded && !options.force) {
      note = await api(`/api/notes/${encodeURIComponent(code)}`);
      upsertNoteInState(note);
    } else if (!state.notesLoaded || options.force) {
      const [loadedNote] = await Promise.all([
        note ? Promise.resolve(note) : api(`/api/notes/${encodeURIComponent(code)}`),
        loadNoteList("newest", options)
      ]);
      note = loadedNote;
      upsertNoteInState(note);
    }

    renderCurrentNote(note);

    showView("note");
  } catch (error) {
    if (error.message !== "Unauthorized") {
      showToast(error.message);
    }
  }
}

function openNewNote() {
  clearTimeout(autosaveTimer);
  state.editingCode = null;
  state.editorDoneMode = false;
  state.editorReturnView = "home";
  recoveryAcknowledgedKey = null;
  hideAutosaveRecovery();
  setAutosaveStatus("");

  $("#editorMode").textContent = "NEW NOTE";
  $("#codePreview").textContent = "?".repeat(NOTE_CODE_LENGTH);
  $("#noteTitle").value = "";
  $("#noteTags").value = "";
  $("#noteContent").value = "";
  $("#noteTitle").readOnly = false;
  $("#noteTags").readOnly = false;
  $("#noteContent").readOnly = false;
  $("#saveBtn").style.display = "";
  $("#cancelBtn").textContent = "Cancel";
  updateTagPreview();
  updateCharCount();
  $("#saveBtn").textContent = "Save & get code";

  showView("editor");
  checkEditorRecovery({ key: AUTOSAVE_NEW_NOTE_KEY });
  setTimeout(() => $("#noteTitle").focus(), 50);
}

function openEditorForNote(note) {
  clearTimeout(autosaveTimer);
  state.editingCode = note.code;
  state.editorDoneMode = false;
  state.editorReturnView = "note";
  recoveryAcknowledgedKey = null;
  hideAutosaveRecovery();
  setAutosaveStatus("");

  $("#editorMode").textContent = "EDIT NOTE";
  $("#codePreview").textContent = note.code;
  $("#noteTitle").value = note.title || "";
  $("#noteTags").value = formatTagsForInput(note.tags);
  $("#noteContent").value = note.content;
  $("#noteTitle").readOnly = false;
  $("#noteTags").readOnly = false;
  $("#noteContent").readOnly = false;
  $("#saveBtn").style.display = "";
  $("#cancelBtn").textContent = "Back";
  updateTagPreview();
  updateCharCount();
  $("#saveBtn").textContent = "Save changes";

  showView("editor");
  checkEditorRecovery({ key: getEditorAutosaveKey(note.code), note });
  setTimeout(() => $("#noteTitle").focus(), 50);
}

async function saveNote() {
  if (isOffline()) {
    showOfflineMessage();
    return;
  }

  const title = normalizeTitle($("#noteTitle").value);
  const content = $("#noteContent").value.trim();
  const tags = readEditorTags();

  if (!content) {
    showToast("Write something first.");
    $("#noteContent").focus();
    return;
  }

  const button = $("#saveBtn");
  button.disabled = true;

  try {
    if (state.editingCode) {
      const autosaveKey = getEditorAutosaveKey(state.editingCode);
      const note = await api(
        `/api/notes/${encodeURIComponent(state.editingCode)}`,
        {
          method: "PUT",
          body: JSON.stringify({ title, content, tags })
        }
      );

      clearTimeout(autosaveTimer);
      removeAutosaveDraft(autosaveKey);
      setAutosaveStatus("");

      if (!upsertNoteInState(note)) {
        state.editorDoneMode = true;
        try {
          await openNote(note.code, { force: true });
          return;
        } finally {
          state.editorDoneMode = false;
        }
      }

      state.currentNote = note;
      $("#codePreview").textContent = note.code;
      showToast("Saved.");
      renderCurrentNote(note);
      showView("note", { skipAutosaveFlush: true });
    } else {
      const autosaveKey = AUTOSAVE_NEW_NOTE_KEY;
      const note = await api("/api/notes", {
        method: "POST",
        body: JSON.stringify({ title, content, tags })
      });

      clearTimeout(autosaveTimer);
      clearAutosaveRecoveryState(autosaveKey);
      setAutosaveStatus("");

      if (!upsertNoteInState(note)) {
        state.notesLoaded = false;
      }

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
  clearTimeout(autosaveTimer);
  state.editorDoneMode = true;
  state.editorReturnView = "home";
  hideAutosaveRecovery();
  setAutosaveStatus("");
  $("#editorMode").textContent = "SAVED";
  $("#codePreview").textContent = code;
  $("#noteTitle").readOnly = true;
  $("#noteTags").readOnly = true;
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
    const deletedCode = state.currentNote.code;

    await api(
      `/api/notes/${encodeURIComponent(state.currentNote.code)}`,
      { method: "DELETE" }
    );

    removeNoteFromState(deletedCode);
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

function updateTagPreview() {
  const preview = $("#tagPreview");
  if (!preview) return;

  const tags = readEditorTags();
  preview.hidden = tags.length === 0;
  preview.innerHTML = renderTagChips(tags);
}

function selectTagFilter(tag) {
  state.selectedTag = normalizeTag(tag);
  showView("notes");
  renderTagFilters();
  renderFilteredNotes();
  $("#listSearch")?.focus();
}

function clearArchiveFilters() {
  const search = $("#listSearch");
  const hadFilters = Boolean(search?.value || state.selectedTag);

  if (search) search.value = "";
  state.selectedTag = null;
  renderTagFilters();
  renderFilteredNotes();

  return hadFilters;
}

function cancelEditor() {
  const wasEditorDoneMode = state.editorDoneMode;

  if (wasEditorDoneMode) {
    state.editorDoneMode = false;
    $("#noteTitle").readOnly = false;
    $("#noteTags").readOnly = false;
    $("#noteContent").readOnly = false;
    $("#saveBtn").style.display = "";
    $("#cancelBtn").textContent = "Cancel";
  }

  showView(state.editorReturnView, wasEditorDoneMode ? { skipAutosaveFlush: true } : {});
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

async function loadSettingsStats(options = {}) {
  const totalNotes = $("#settingsTotalNotes");

  if (totalNotes && (!state.notesLoaded || options.force)) totalNotes.textContent = "Loading...";

  try {
    const notes = await loadNoteList("newest", options);
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
  applyNoteFontSize(getStoredNoteFontSize());

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
    .querySelectorAll("input[name='noteFontSizePreference']")
    .forEach(input => {
      input.addEventListener("change", () => saveNoteFontSize(input.value));
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
  return state.authState === AUTH_STATES.AUTHENTICATED && !isTypingTarget(event.target) && !isModalOpen();
}

function isPlainKeyEvent(event) {
  return !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
}

function isEditorDoneAvailable() {
  return state.currentView === "editor" &&
    state.editorDoneMode &&
    $("#saveBtn").style.display === "none" &&
    !$("#saveBtn").disabled;
}

function goBackFromNote() {
  showView("home");
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

  if (event.key === "Escape" && isPlainKeyEvent(event) && canUseAppShortcuts(event)) {
    if (state.currentView === "notes" && ($("#listSearch").value || state.selectedTag)) {
      event.preventDefault();
      clearArchiveFilters();
      return;
    }

    if (state.currentView === "editor") {
      event.preventDefault();
      cancelEditor();
      return;
    }

    if (state.currentView === "note") {
      event.preventDefault();
      goBackFromNote();
      return;
    }
  }

  if (event.key === "Enter" && isPlainKeyEvent(event) && canUseAppShortcuts(event) && isEditorDoneAvailable()) {
    event.preventDefault();
    cancelEditor();
    return;
  }

  if (key === "n" && isPlainKeyEvent(event) && canUseAppShortcuts(event)) {
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

    showAuthenticatedApp();
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
$("#noteBack").addEventListener("click", goBackFromNote);
$("#editBtn").addEventListener("click", () => openEditorForNote(state.currentNote));
$("#deleteBtn").addEventListener("click", deleteCurrentNote);
deleteCancelBtn?.addEventListener("click", () => {
  const cancelHandler = pendingDeleteCancelHandler;
  closeDeleteModal(false);
  cancelHandler?.();
});
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

$("#noteTagsView")?.addEventListener("click", event => {
  const tag = event.target.closest("[data-tag]");
  if (!tag) return;

  selectTagFilter(tag.dataset.tag);
});

$("#noteTagsView")?.addEventListener("keydown", event => {
  if (event.key !== "Enter" && event.key !== " ") return;

  const tag = event.target.closest("[data-tag]");
  if (!tag) return;

  event.preventDefault();
  selectTagFilter(tag.dataset.tag);
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
$("#noteTitle").addEventListener("input", scheduleAutosave);
$("#noteTags").addEventListener("input", () => {
  updateTagPreview();
  scheduleAutosave();
});
$("#noteContent").addEventListener("input", () => {
  updateCharCount();
  scheduleAutosave();
});
$("#autosaveContinueBtn")?.addEventListener("click", restoreAutosaveDraft);
$("#autosaveDiscardBtn")?.addEventListener("click", confirmAndDiscardAutosaveDraft);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    flushPendingAutosave({ silent: true });
  }
});

window.addEventListener("pagehide", () => {
  flushPendingAutosave({ silent: true });
});

$("#logoutBtn").addEventListener("click", async () => {
  await fetch("/api/auth/logout", {
    method: "POST",
    cache: "no-store",
    credentials: "same-origin"
  }).catch(() => { });

  showUnauthenticatedApp();
});

async function initializeAuth() {
  setAuthState(AUTH_STATES.LOADING);

  try {
    if (isOffline()) {
      showUnauthenticatedApp(OFFLINE_MESSAGE);
      return;
    }

    const response = await fetch("/api/auth/session", {
      cache: "no-store",
      credentials: "same-origin"
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok && body.authenticated) {
      showAuthenticatedApp();
      await loadRecent();
      return;
    }
  } catch {
    showUnauthenticatedApp("Unable to check your session. Try again.");
    return;
  }

  showUnauthenticatedApp();
}

initializeSettingsControls();
registerServiceWorker();
registerConnectionStatus();
initializeAuth();
