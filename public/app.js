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

const $ = (selector) => document.querySelector(selector);

const passwordModal = $("#passwordModal");
const passwordForm = $("#passwordForm");
const passwordInput = $("#passwordInput");
const loginError = $("#loginError");

function getPassword() {
  return localStorage.getItem("thinkmark_password") || "";
}

function setPassword(password) {
  localStorage.setItem("thinkmark_password", password);
}

function clearPassword() {
  localStorage.removeItem("thinkmark_password");
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
  const password = getPassword();

  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      "X-ThinkMark-Password": password,
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    clearPassword();
    passwordModal.style.display = "grid";
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

    $("#noteContentView").textContent = note.content;

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

  setPassword(password);
  loginError.textContent = "";

  try {
    await api("/api/notes?sort=newest");

    passwordModal.style.display = "none";
    passwordInput.value = "";
    await loadRecent();
  } catch {
    clearPassword();
    loginError.textContent = "Wrong password or server unavailable.";
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

$("#logoutBtn").addEventListener("click", () => {
  clearPassword();
  location.reload();
});

if (getPassword()) {
  passwordModal.style.display = "none";
  loadRecent();
} else {
  passwordModal.style.display = "grid";
  setTimeout(() => passwordInput.focus(), 100);
}
