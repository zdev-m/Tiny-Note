(() => {
  "use strict";

  /* ===================== Store (persisted in the browser) ===================== */
  const NOTES_KEY = "tinynote.notes.v1";
  const SETTINGS_KEY = "tinynote.settings.v1";
  const HISTORY_KEY = "tinynote.history.v1";

  const uid = () => "n_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch { return []; }
  }
  function saveNotes(notes) { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }

  function loadSettings() {
    const defaults = { theme: "light", sortBy: "updated", sidebarWidth: 300, activeId: null, recentSearches: [] };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch { return defaults; }
  }
  function saveSettings(s) { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); }

  function pushHistory(noteId, content) {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      const map = raw ? JSON.parse(raw) : {};
      const list = map[noteId] || [];
      const last = list[list.length - 1];
      if (last && last.c === content) return;
      list.push({ t: Date.now(), c: content });
      map[noteId] = list.slice(-30);
      localStorage.setItem(HISTORY_KEY, JSON.stringify(map));
    } catch { /* ignore quota */ }
  }
  function loadHistory(noteId) {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const map = JSON.parse(raw);
      return map[noteId] || [];
    } catch { return []; }
  }

  const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "LI", "BLOCKQUOTE", "PRE", "UL", "OL", "BR", "HR"]);
  function stripHtml(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    // Insert a space between block-level elements so adjacent blocks (e.g. a
    // heading followed by a paragraph) don't run together as one word when
    // used for previews, search, and .txt export.
    el.querySelectorAll("*").forEach((node) => {
      if (BLOCK_TAGS.has(node.tagName)) node.insertAdjacentText("afterend", " ");
    });
    return (el.textContent || "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  }
  function autoTitle(content) {
    const text = stripHtml(content).trim();
    if (!text) return "Untitled";
    const firstLine = text.split(/\n/)[0].trim();
    return firstLine.slice(0, 80) || "Untitled";
  }
  function countStats(content) {
    const text = stripHtml(content).trim();
    const chars = text.length;
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    const readingMin = Math.max(1, Math.round(words / 200));
    return { chars, words, readingMin };
  }
  function makeNote(overrides = {}) {
    const now = Date.now();
    return {
      id: uid(), title: "Untitled", content: "", createdAt: now, updatedAt: now,
      pinned: false, favorite: false, color: null, trashed: false, order: now,
      ...overrides,
    };
  }

  /* ===================== Helpers ===================== */
  const fmt = (t) => {
    const now = Date.now();
    const diff = (now - t) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(t).toLocaleDateString();
  };
  const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  function highlightHTML(html, query) {
    if (!query) return html;
    const el = document.createElement("div");
    el.innerHTML = html;
    const re = new RegExp(escapeReg(query), "gi");
    const walk = (node) => {
      if (node.nodeType === 3) {
        const text = node.nodeValue || "";
        if (!re.test(text)) return;
        re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        text.replace(re, (m, i) => {
          frag.appendChild(document.createTextNode(text.slice(last, i)));
          const mark = document.createElement("mark");
          mark.className = "search-hit";
          mark.textContent = m;
          frag.appendChild(mark);
          last = i + m.length;
          return m;
        });
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      } else if (node.nodeType === 1 && node.tagName !== "MARK") {
        Array.from(node.childNodes).forEach(walk);
      }
    };
    Array.from(el.childNodes).forEach(walk);
    return el.innerHTML;
  }

  function download(name, content, type = "text/plain") {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = name; a.click();
    URL.revokeObjectURL(url);
  }

  function htmlToMarkdown(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    const walk = (node) => {
      if (node.nodeType === 3) return node.nodeValue || "";
      if (node.nodeType !== 1) return "";
      const e = node;
      const kids = Array.from(e.childNodes).map(walk).join("");
      switch (e.tagName) {
        case "H1": return `\n# ${kids}\n`;
        case "H2": return `\n## ${kids}\n`;
        case "H3": return `\n### ${kids}\n`;
        case "STRONG": case "B": return `**${kids}**`;
        case "EM": case "I": return `*${kids}*`;
        case "U": return `<u>${kids}</u>`;
        case "BLOCKQUOTE": return `\n> ${kids}\n`;
        case "PRE": return `\n\`\`\`\n${e.textContent}\n\`\`\`\n`;
        case "CODE": return `\`${kids}\``;
        case "HR": return `\n---\n`;
        case "BR": return `\n`;
        case "UL": return `\n${Array.from(e.children).map((c) => `- ${walk(c)}`).join("\n")}\n`;
        case "OL": return `\n${Array.from(e.children).map((c, i) => `${i + 1}. ${walk(c)}`).join("\n")}\n`;
        case "LI": return kids.trim();
        case "P": case "DIV": return `${kids}\n`;
        default: return kids;
      }
    };
    return Array.from(el.childNodes).map(walk).join("").replace(/\n{3,}/g, "\n\n").trim();
  }

  /* ===================== State ===================== */
  let notes = [];
  let settings = { theme: "light", sortBy: "updated", sidebarWidth: 300, activeId: null, recentSearches: [] };
  let query = "";
  let showTrash = false;
  let zen = false;
  let focusMode = false;
  let viewOnly = false;
  let savedAt = null;
  let dragId = null;
  let saveTimer = null;
  let historyTimer = null;
  let resizing = false;
  let dragDepth = 0;

  const mobileMql = window.matchMedia("(max-width: 720px)");
  let isMobile = mobileMql.matches;
  let mobileEditorOpen = false;

  /* ===================== DOM refs ===================== */
  const $ = (id) => document.getElementById(id);
  const root = $("app");
  const sidebar = $("sidebar");
  const searchInput = $("searchInput");
  const btnClearSearch = $("btnClearSearch");
  const recentSearchesEl = $("recentSearches");
  const tabAll = $("tabAll");
  const tabTrash = $("tabTrash");
  const sortSelect = $("sortSelect");
  const notesListEl = $("notesList");
  const mainPanel = $("mainPanel");
  const editorView = $("editorView");
  const emptyState = $("emptyState");
  const titleInput = $("titleInput");
  const editor = $("editor");
  const statWords = $("statWords");
  const statChars = $("statChars");
  const statRead = $("statRead");
  const statSaved = $("statSaved");
  const statEdited = $("statEdited");
  const importFileInput = $("importFileInput");
  const cmdOverlay = $("cmdOverlay");
  const cmdInput = $("cmdInput");
  const cmdBody = $("cmdBody");
  const historyOverlay = $("historyOverlay");
  const historyBody = $("historyBody");
  const dropOverlay = $("dropOverlay");

  /* ===================== Init ===================== */
  function init() {
    settings = loadSettings();
    notes = loadNotes();
    if (notes.length === 0) {
      const welcome = makeNote({
        title: "Welcome to TinyNote",
        content:
          "<h1>Welcome to TinyNote</h1><p>A private space for your thoughts, fast enough to keep up with them.</p><p><strong>Try:</strong></p><ul><li>Press <code>Ctrl/⌘ K</code> for the command palette</li><li>Format with <code>Ctrl+B</code>, <code>Ctrl+I</code></li><li>Export, or import — even by dragging a file onto the app</li></ul><blockquote>Just you and your thoughts.</blockquote>",
      });
      notes = [welcome];
      settings.activeId = welcome.id;
      saveNotes(notes);
      saveSettings(settings);
    }
    applyTheme();
    sidebar.style.width = settings.sidebarWidth + "px";
    sortSelect.value = settings.sortBy;
    bindEvents();

    // On mobile, always start on the notes list rather than jumping
    // straight into whichever note was last open.
    isMobile = mobileMql.matches;
    mobileEditorOpen = false;

    renderAll();
  }

  function renderMobileLayout() {
    if (!isMobile) {
      sidebar.classList.remove("mobile-hide");
      mainPanel.classList.remove("mobile-show");
      return;
    }
    sidebar.classList.toggle("mobile-hide", mobileEditorOpen);
    mainPanel.classList.toggle("mobile-show", mobileEditorOpen);
  }

  function applyTheme() {
    document.documentElement.classList.remove("dark", "amoled", "sepia");
    if (settings.theme !== "light") document.documentElement.classList.add(settings.theme);
    saveSettings(settings);
    document.querySelectorAll(".theme-chip").forEach((chip) => {
      chip.classList.toggle("active", chip.dataset.theme === settings.theme);
    });
  }

  function getActive() { return notes.find((n) => n.id === settings.activeId) || null; }

  function setActive(id) {
    settings.activeId = id;
    saveSettings(settings);
    if (isMobile) mobileEditorOpen = true;
    renderAll();
  }

  function updateNote(id, patch) {
    notes = notes.map((n) => (n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n));
    saveNotes(notes);
  }

  function persistNotes() { saveNotes(notes); }

  /* ===================== Rendering ===================== */
  function getVisible() {
    const q = query.trim().toLowerCase();
    let list = notes.filter((n) => n.trashed === showTrash);
    if (q) {
      list = list.filter((n) => n.title.toLowerCase().includes(q) || stripHtml(n.content).toLowerCase().includes(q));
    }
    const cmp = (a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (settings.sortBy === "name") return a.title.localeCompare(b.title);
      if (settings.sortBy === "created") return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    };
    return list.slice().sort(cmp);
  }

  function renderAll() {
    root.classList.toggle("zen", zen);
    root.classList.toggle("focus-mode", focusMode);
    renderMobileLayout();
    renderRecentSearches();
    renderTabs();
    renderNotesList();
    renderEditorArea();
    updateToolbarActiveStates();
  }

  function renderRecentSearches() {
    recentSearchesEl.innerHTML = "";
    if (query || settings.recentSearches.length === 0) return;
    settings.recentSearches.forEach((r) => {
      const b = document.createElement("button");
      b.className = "recent-chip";
      b.textContent = r;
      b.onclick = () => { query = r; searchInput.value = r; toggleClearBtn(); renderAll(); };
      recentSearchesEl.appendChild(b);
    });
  }

  function renderTabs() {
    tabAll.classList.toggle("tab-active", !showTrash);
    tabTrash.classList.toggle("tab-active", showTrash);
  }

  function renderNotesList() {
    const visible = getVisible();
    notesListEl.innerHTML = "";

    if (visible.length === 0) {
      const wrap = document.createElement("div");
      wrap.className = "empty-list";
      wrap.innerHTML = `
        <div class="empty-list-icon"><svg viewBox="0 0 24 24" class="icon" style="width:22px;height:22px"><use href="#i-book"/></svg></div>
        <p>${showTrash ? "Trash is empty." : query ? "No matches." : "No notes yet."}</p>`;
      notesListEl.appendChild(wrap);
      if (!showTrash && !query) {
        const btn = document.createElement("button");
        btn.className = "create-first-btn";
        btn.textContent = "Create first note";
        btn.onclick = newNote;
        wrap.appendChild(btn);
      }
    }

    visible.forEach((n) => {
      const isActive = n.id === settings.activeId;
      const previewText = stripHtml(n.content).slice(0, 90);
      const card = document.createElement("div");
      card.className = "note-card anim-float" + (isActive ? " active" : "");
      card.draggable = !showTrash;
      if (n.color) card.style.boxShadow = `inset 3px 0 0 0 ${n.color}`;

      const titleHtml = query ? highlightHTML(escapeHtml(n.title || "Untitled"), query) : escapeHtml(n.title || "Untitled");

      card.innerHTML = `
        <div class="note-top">
          <span class="note-title">${titleHtml}</span>
          ${n.pinned ? '<svg viewBox="0 0 24 24" class="icon icon-xs pin-mark"><use href="#i-pin"/></svg>' : ""}
          ${n.favorite ? '<svg viewBox="0 0 24 24" class="icon icon-xs fav-mark"><use href="#i-star"/></svg>' : ""}
        </div>
        <div class="note-preview">${escapeHtml(previewText) || "Empty note"}</div>
        <div class="note-meta">
          <span>${fmt(n.updatedAt)}</span>
          <div class="note-actions"></div>
        </div>`;

      const actions = card.querySelector(".note-actions");
      if (!showTrash) {
        actions.appendChild(iconBtn("i-pin", "Pin", (e) => { e.stopPropagation(); togglePin(n.id); }));
        actions.appendChild(iconBtn("i-star", "Favorite", (e) => { e.stopPropagation(); toggleFav(n.id); }));
        actions.appendChild(iconBtn("i-copy", "Duplicate", (e) => { e.stopPropagation(); duplicateNote(n.id); }));
        actions.appendChild(iconBtn("i-trash", "Delete", (e) => { e.stopPropagation(); trashNote(n.id); }));
      } else {
        actions.appendChild(iconBtn("i-undo", "Restore", (e) => { e.stopPropagation(); restoreNote(n.id); }));
        actions.appendChild(iconBtn("i-x", "Delete forever", (e) => { e.stopPropagation(); deleteForever(n.id); }));
      }

      card.addEventListener("click", () => setActive(n.id));
      card.addEventListener("dragstart", () => { dragId = n.id; });
      card.addEventListener("dragover", (e) => e.preventDefault());
      card.addEventListener("drop", () => onDrop(n.id));

      notesListEl.appendChild(card);
    });

    if (showTrash && visible.length > 0) {
      const btn = document.createElement("button");
      btn.className = "empty-trash-btn";
      btn.textContent = "Empty trash";
      btn.onclick = emptyTrash;
      notesListEl.appendChild(btn);
    }
  }

  function iconBtn(iconId, title, onClick) {
    const b = document.createElement("button");
    b.className = "icon-btn-xs";
    b.title = title;
    b.innerHTML = `<svg viewBox="0 0 24 24" class="icon"><use href="#${iconId}"/></svg>`;
    b.onclick = onClick;
    return b;
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderEditorArea() {
    const active = getActive();
    if (!active) {
      editorView.classList.add("hidden");
      emptyState.classList.remove("hidden");
      return;
    }
    emptyState.classList.add("hidden");
    editorView.classList.remove("hidden");

    if (document.activeElement !== titleInput) titleInput.value = active.title;

    if (editor.innerHTML !== active.content && document.activeElement !== editor) {
      editor.innerHTML = active.content || "";
    }
    editor.setAttribute("data-empty", editor.textContent.trim() ? "" : "Start writing…");

    editor.setAttribute("contenteditable", viewOnly ? "false" : "true");
    titleInput.readOnly = viewOnly;
    document.querySelectorAll("#btnUndo, #btnRedo, #btnHr, #btnColor, [data-cmd], [data-block]").forEach((b) => {
      b.disabled = viewOnly;
    });

    $("btnPin").classList.toggle("active", !!active.pinned);
    $("btnFav").classList.toggle("fav-active", !!active.favorite);
    $("btnPreview").classList.toggle("active", viewOnly);

    const stats = countStats(active.content);
    statWords.textContent = `${stats.words} words`;
    statChars.textContent = `${stats.chars} chars`;
    statRead.textContent = `~${stats.readingMin} min read`;
    statSaved.innerHTML = savedAt ? `<span class="save-dot"></span>Saved ${fmt(savedAt)}` : "";
    statEdited.textContent = `Edited ${fmt(active.updatedAt)}`;
  }

  /* ===================== Actions ===================== */
  function newNote() {
    const n = makeNote();
    notes = [n, ...notes];
    persistNotes();
    showTrash = false;
    setActive(n.id);
    setTimeout(() => editor.focus(), 60);
  }

  function duplicateNote(id) {
    const src = notes.find((n) => n.id === (id || settings.activeId));
    if (!src) return;
    const n = makeNote({ title: src.title + " copy", content: src.content, color: src.color });
    notes = [n, ...notes];
    persistNotes();
    setActive(n.id);
  }

  function trashNote(id) {
    notes = notes.map((n) => (n.id === id ? { ...n, trashed: true, trashedAt: Date.now() } : n));
    persistNotes(); renderAll();
  }
  function restoreNote(id) {
    notes = notes.map((n) => (n.id === id ? { ...n, trashed: false } : n));
    persistNotes(); renderAll();
  }
  function deleteForever(id) {
    notes = notes.filter((n) => n.id !== id);
    persistNotes(); renderAll();
  }
  function emptyTrash() {
    notes = notes.filter((n) => !n.trashed);
    persistNotes(); renderAll();
  }
  function togglePin(id) {
    notes = notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned } : n));
    persistNotes(); renderAll();
  }
  function toggleFav(id) {
    notes = notes.map((n) => (n.id === id ? { ...n, favorite: !n.favorite } : n));
    persistNotes(); renderAll();
  }
  function setColor(id, color) {
    notes = notes.map((n) => (n.id === id ? { ...n, color: color || null } : n));
    persistNotes(); renderAll();
  }

  function exportNote(n, kind) {
    const base = (n.title || "note").replace(/[^\w-]+/g, "_");
    if (kind === "txt") download(`${base}.txt`, stripHtml(n.content));
    else if (kind === "md") download(`${base}.md`, `# ${n.title}\n\n${htmlToMarkdown(n.content)}`);
    else download(`${base}.json`, JSON.stringify(n, null, 2), "application/json");
  }

  function exportAll() {
    const payload = { version: 1, exportedAt: Date.now(), notes };
    download(`tinynote-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
  }

  async function importFile(file) {
    const text = await file.text();
    try {
      if (file.name.endsWith(".json")) {
        const data = JSON.parse(text);
        const incoming = Array.isArray(data) ? data : data.notes || [data];
        const clean = incoming.filter((x) => x && typeof x === "object").map((x) => makeNote({ ...x, id: makeNote().id }));
        notes = [...clean, ...notes];
        persistNotes(); renderAll();
        return;
      }
      const n = makeNote({
        title: file.name.replace(/\.[^.]+$/, ""),
        content: file.name.endsWith(".md")
          ? `<pre>${text.replace(/</g, "&lt;")}</pre>`
          : `<p>${text.replace(/</g, "&lt;").replace(/\n/g, "</p><p>")}</p>`,
      });
      notes = [n, ...notes];
      persistNotes();
      setActive(n.id);
    } catch (e) {
      alert("Import failed: " + e.message);
    }
  }

  function onDrop(targetId) {
    if (!dragId || dragId === targetId) return;
    const arr = [...notes];
    const from = arr.findIndex((n) => n.id === dragId);
    const to = arr.findIndex((n) => n.id === targetId);
    if (from >= 0 && to >= 0) {
      const [m] = arr.splice(from, 1);
      arr.splice(to, 0, m);
      notes = arr;
      persistNotes(); renderAll();
    }
    dragId = null;
  }

  function onEditorInput() {
    const active = getActive();
    if (!active) return;
    const html = editor.innerHTML;
    editor.setAttribute("data-empty", editor.textContent.trim() ? "" : "Start writing…");

    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const title = active.title === "Untitled" || !active.title ? autoTitle(html) : active.title;
      updateNote(active.id, { content: html, title });
      savedAt = Date.now();
      renderNotesList();
      renderStatsOnly();
    }, 250);

    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => pushHistory(active.id, html), 4000);
  }

  function renderStatsOnly() {
    const active = getActive();
    if (!active) return;
    const stats = countStats(active.content);
    statWords.textContent = `${stats.words} words`;
    statChars.textContent = `${stats.chars} chars`;
    statRead.textContent = `~${stats.readingMin} min read`;
    statSaved.innerHTML = savedAt ? `<span class="save-dot"></span>Saved ${fmt(savedAt)}` : "";
    statEdited.textContent = `Edited ${fmt(active.updatedAt)}`;
  }

  function exec(cmd, val) {
    if (viewOnly) return;
    editor.focus();
    document.execCommand(cmd, false, val);
    onEditorInput();
    updateToolbarActiveStates();
  }

  const TRACKED_CMDS = ["bold", "italic", "underline", "insertUnorderedList", "insertOrderedList"];
  const TRACKED_BLOCKS = ["H1", "H2", "H3", "BLOCKQUOTE", "PRE"];

  function isSelectionInEditor() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    return editor.contains(sel.getRangeAt(0).commonAncestorContainer);
  }

  function getBlockTag() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return "";
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    while (node && node !== editor) {
      if (TRACKED_BLOCKS.includes(node.tagName)) return node.tagName;
      node = node.parentElement;
    }
    return "";
  }

  function updateToolbarActiveStates() {
    const inEditor = !viewOnly && document.activeElement === editor && isSelectionInEditor();

    document.querySelectorAll("[data-cmd]").forEach((b) => {
      let state = false;
      if (inEditor && TRACKED_CMDS.includes(b.dataset.cmd)) {
        try { state = document.queryCommandState(b.dataset.cmd); } catch { state = false; }
      }
      b.classList.toggle("active", state);
    });

    const blockTag = inEditor ? getBlockTag() : "";
    document.querySelectorAll("[data-block]").forEach((b) => {
      b.classList.toggle("active", b.dataset.block === blockTag);
    });
  }

  function toggleFullscreen() {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen?.();
      $("fsLabel").textContent = "Exit fullscreen";
    } else {
      document.exitFullscreen?.();
      $("fsLabel").textContent = "Fullscreen";
    }
  }

  /* ===================== Command palette ===================== */
  function actionsList() {
    const active = getActive();
    return [
      { label: "New note", hint: "⌘N", run: () => { newNote(); closeCmd(); } },
      { label: "Duplicate active", hint: "⌘D", run: () => { duplicateNote(); closeCmd(); } },
      { label: "Export active as Markdown", hint: "⌘S", run: () => { active && exportNote(active, "md"); closeCmd(); } },
      { label: "Export all (backup)", run: () => { exportAll(); closeCmd(); } },
      { label: "Toggle Zen mode", run: () => { zen = !zen; renderAll(); closeCmd(); } },
      { label: "Toggle Focus mode", run: () => { focusMode = !focusMode; renderAll(); closeCmd(); } },
      { label: "Theme: Light", run: () => { settings.theme = "light"; applyTheme(); closeCmd(); } },
      { label: "Theme: Dark", run: () => { settings.theme = "dark"; applyTheme(); closeCmd(); } },
      { label: "Theme: AMOLED", run: () => { settings.theme = "amoled"; applyTheme(); closeCmd(); } },
      { label: "Theme: Sepia", run: () => { settings.theme = "sepia"; applyTheme(); closeCmd(); } },
    ];
  }

  function openCmd() {
    cmdOverlay.classList.remove("hidden");
    cmdInput.value = "";
    cmdInput.focus();
    renderCmd("");
  }
  function closeCmd() { cmdOverlay.classList.add("hidden"); }

  function renderCmd(q) {
    const ql = q.toLowerCase();
    const actions = actionsList().filter((a) => a.label.toLowerCase().includes(ql));
    const noteList = q
      ? notes.filter((n) => n.title.toLowerCase().includes(ql) || stripHtml(n.content).toLowerCase().includes(ql)).slice(0, 8)
      : notes.slice(0, 6);

    cmdBody.innerHTML = "";
    if (actions.length > 0) {
      const label = document.createElement("div");
      label.className = "cmd-section-label";
      label.textContent = "Actions";
      cmdBody.appendChild(label);
      actions.forEach((a) => {
        const row = document.createElement("button");
        row.className = "cmd-row";
        row.innerHTML = `<span style="flex:1">${escapeHtml(a.label)}</span>${a.hint ? `<kbd style="font-size:10px;color:var(--muted-foreground)">${a.hint}</kbd>` : ""}`;
        row.onclick = a.run;
        cmdBody.appendChild(row);
      });
    }
    if (noteList.length > 0) {
      const label = document.createElement("div");
      label.className = "cmd-section-label";
      label.textContent = "Notes";
      cmdBody.appendChild(label);
      noteList.forEach((n) => {
        const row = document.createElement("button");
        row.className = "cmd-row";
        row.innerHTML = `<svg viewBox="0 0 24 24" class="icon icon-sm muted"><use href="#i-book"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(n.title || "Untitled")}</span><span style="font-size:10px;color:var(--muted-foreground)">${fmt(n.updatedAt)}</span>`;
        row.onclick = () => { setActive(n.id); closeCmd(); };
        cmdBody.appendChild(row);
      });
    }
    if (actions.length === 0 && noteList.length === 0) {
      const div = document.createElement("div");
      div.className = "cmd-empty";
      div.textContent = "No matches";
      cmdBody.appendChild(div);
    }
  }

  /* ===================== History panel ===================== */
  function openHistory() {
    const active = getActive();
    if (!active) return;
    const versions = loadHistory(active.id).slice().reverse();
    historyBody.innerHTML = "";
    if (versions.length === 0) {
      const div = document.createElement("div");
      div.className = "history-empty";
      div.textContent = "No versions yet. Keep writing to build a history here.";
      historyBody.appendChild(div);
    }
    versions.forEach((v) => {
      const item = document.createElement("div");
      item.className = "history-item";
      item.innerHTML = `
        <div class="history-item-top">
          <span style="font-weight:500">${new Date(v.t).toLocaleString()}</span>
          <button class="history-restore">Restore</button>
        </div>
        <div class="history-snippet">${escapeHtml(stripHtml(v.c).slice(0, 200)) || "Empty"}</div>`;
      item.querySelector(".history-restore").onclick = () => {
        updateNote(active.id, { content: v.c });
        editor.innerHTML = v.c;
        historyOverlay.classList.add("hidden");
        renderAll();
      };
      historyBody.appendChild(item);
    });
    historyOverlay.classList.remove("hidden");
  }

  /* ===================== Events ===================== */
  function toggleClearBtn() { btnClearSearch.classList.toggle("hidden", !query); }

  function bindEvents() {
    $("btnNewNoteTop").onclick = newNote;
    $("btnEmptyNew").onclick = newNote;

    searchInput.addEventListener("input", (e) => { query = e.target.value; toggleClearBtn(); renderAll(); });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && query.trim()) {
        settings.recentSearches = [query, ...settings.recentSearches.filter((x) => x !== query)].slice(0, 6);
        saveSettings(settings);
        renderRecentSearches();
      }
    });
    btnClearSearch.onclick = () => { query = ""; searchInput.value = ""; toggleClearBtn(); renderAll(); };

    tabAll.onclick = () => { showTrash = false; renderAll(); };
    tabTrash.onclick = () => { showTrash = true; renderAll(); };

    sortSelect.onchange = (e) => { settings.sortBy = e.target.value; saveSettings(settings); renderAll(); };

    document.querySelectorAll(".theme-chip").forEach((chip) => {
      chip.onclick = () => { settings.theme = chip.dataset.theme; applyTheme(); };
    });

    $("btnCmdPalette2").onclick = openCmd;

    // Toolbar
    titleInput.addEventListener("input", () => {
      const active = getActive();
      if (!active) return;
      updateNote(active.id, { title: titleInput.value });
      renderNotesList();
    });

    $("btnUndo").onclick = () => exec("undo");
    $("btnRedo").onclick = () => exec("redo");
    document.querySelectorAll("[data-cmd]").forEach((b) => { b.onclick = () => exec(b.dataset.cmd); });
    document.querySelectorAll("[data-block]").forEach((b) => { b.onclick = () => exec("formatBlock", b.dataset.block); });
    $("btnHr").onclick = () => exec("insertHorizontalRule");

    // Color popover
    const colorPopover = $("colorPopover");
    $("btnColor").onclick = (e) => { e.stopPropagation(); colorPopover.classList.toggle("hidden"); };
    colorPopover.querySelectorAll(".swatch").forEach((sw) => {
      sw.onclick = () => {
        const active = getActive();
        if (active) setColor(active.id, sw.dataset.color);
        colorPopover.classList.add("hidden");
      };
    });

    $("btnPin").onclick = () => { const a = getActive(); if (a) togglePin(a.id); };
    $("btnFav").onclick = () => { const a = getActive(); if (a) toggleFav(a.id); };
    $("btnPreview").onclick = () => { viewOnly = !viewOnly; renderEditorArea(); updateToolbarActiveStates(); };
    $("btnHistory").onclick = openHistory;
    $("btnCloseHistory").onclick = () => historyOverlay.classList.add("hidden");
    historyOverlay.onclick = (e) => { if (e.target === historyOverlay) historyOverlay.classList.add("hidden"); };

    // More menu
    const moreMenu = $("moreMenu");
    $("btnMore").onclick = (e) => { e.stopPropagation(); moreMenu.classList.toggle("hidden"); };
    $("mExportTxt").onclick = () => { const a = getActive(); if (a) exportNote(a, "txt"); moreMenu.classList.add("hidden"); };
    $("mExportMd").onclick = () => { const a = getActive(); if (a) exportNote(a, "md"); moreMenu.classList.add("hidden"); };
    $("mExportJson").onclick = () => { const a = getActive(); if (a) exportNote(a, "json"); moreMenu.classList.add("hidden"); };
    $("mExportAll").onclick = () => { exportAll(); moreMenu.classList.add("hidden"); };
    $("mImport").onclick = () => { importFileInput.click(); moreMenu.classList.add("hidden"); };
    $("mZen").onclick = () => { zen = !zen; renderAll(); moreMenu.classList.add("hidden"); };
    $("mFocus").onclick = () => { focusMode = !focusMode; renderAll(); moreMenu.classList.add("hidden"); };
    $("mFullscreen").onclick = () => { toggleFullscreen(); moreMenu.classList.add("hidden"); };

    importFileInput.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files) Array.from(files).forEach((f) => importFile(f));
      e.target.value = "";
    });

    document.addEventListener("click", () => {
      colorPopover.classList.add("hidden");
      moreMenu.classList.add("hidden");
    });

    editor.addEventListener("input", onEditorInput);
    editor.addEventListener("keyup", updateToolbarActiveStates);
    editor.addEventListener("mouseup", updateToolbarActiveStates);
    editor.addEventListener("focus", updateToolbarActiveStates);
    editor.addEventListener("blur", updateToolbarActiveStates);
    document.addEventListener("selectionchange", updateToolbarActiveStates);

    // Keep the selection alive when clicking a toolbar button so formatting
    // is applied to the text the user actually selected.
    document.querySelectorAll(".toolbar .tool-btn").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault());
    });

    // Command palette
    cmdInput.addEventListener("input", (e) => renderCmd(e.target.value));
    cmdOverlay.addEventListener("click", (e) => { if (e.target === cmdOverlay) closeCmd(); });

    // Sidebar resize
    const resizeHandle = $("resizeHandle");
    resizeHandle.addEventListener("mousedown", () => { resizing = true; });
    window.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      const w = Math.max(220, Math.min(480, e.clientX));
      settings.sidebarWidth = w;
      sidebar.style.width = w + "px";
    });
    window.addEventListener("mouseup", () => {
      if (resizing) { resizing = false; saveSettings(settings); }
    });

    // Keyboard shortcuts
    window.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); cmdOverlay.classList.contains("hidden") ? openCmd() : closeCmd(); return; }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newNote(); return; }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); searchInput.focus(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateNote(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); const a = getActive(); if (a) exportNote(a, "md"); return; }
      if (e.key === "Escape") { closeCmd(); historyOverlay.classList.add("hidden"); }
    });

    document.addEventListener("fullscreenchange", () => {
      $("fsLabel").textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    });

    $("btnMobileBack").onclick = () => { mobileEditorOpen = false; renderMobileLayout(); };
    mobileMql.addEventListener("change", (e) => { isMobile = e.matches; renderMobileLayout(); });

    // Drag-and-drop file import: dragging a .txt/.md/.json file anywhere onto
    // the app imports it as a new note, with a full-screen visual cue.
    const hasFiles = (e) => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");

    window.addEventListener("dragenter", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      dropOverlay.classList.remove("hidden");
    });
    window.addEventListener("dragover", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
    });
    window.addEventListener("dragleave", (e) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) dropOverlay.classList.add("hidden");
    });
    window.addEventListener("drop", (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      dropOverlay.classList.add("hidden");
      const files = e.dataTransfer ? Array.from(e.dataTransfer.files) : [];
      files.forEach((f) => importFile(f));
    });
  }

  init();
})();
