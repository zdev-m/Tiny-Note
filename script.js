(() => {
  const NOTES_KEY = "tinynote.notes.v1";
  const SETTINGS_KEY = "tinynote.settings.v1";
  const HISTORY_KEY = "tinynote.history.v1";
  const uid = () => "n_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch(() => {
      });
    });
  }
  function loadNotes() {
    try {
      const raw = localStorage.getItem(NOTES_KEY);
      if (!raw) return [];
      return JSON.parse(raw);
    } catch {
      return [];
    }
  }
  function saveNotes(list) {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(list));
    } catch (e) {
      alert("Could not save your notes \u2014 your device storage may be full. Please export a backup and free up space.");
    }
  }
  const SANITIZE_DISALLOWED_TAGS = /* @__PURE__ */ new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "LINK", "META", "FORM", "BASE", "SVG", "MATH"]);
  function sanitizeHtml(html) {
    const template = document.createElement("template");
    template.innerHTML = String(html || "");
    const walk = (node) => {
      Array.from(node.childNodes).forEach((child) => {
        if (child.nodeType === 1) {
          if (SANITIZE_DISALLOWED_TAGS.has(child.tagName)) {
            child.remove();
            return;
          }
          Array.from(child.attributes).forEach((attr) => {
            const name = attr.name.toLowerCase();
            const value = attr.value.trim();
            if (name.startsWith("on")) {
              child.removeAttribute(attr.name);
            } else if ((name === "href" || name === "src" || name === "action") && /^\s*javascript:/i.test(value)) {
              child.removeAttribute(attr.name);
            } else if (name === "style" && /expression\s*\(|javascript:/i.test(value)) {
              child.removeAttribute(attr.name);
            }
          });
          walk(child);
        } else if (child.nodeType === 8) {
          child.remove();
        }
      });
    };
    walk(template.content);
    return template.innerHTML;
  }
  function loadSettings() {
    const defaults = { theme: "light", sortBy: "updated", sidebarWidth: 300, activeId: null, recentSearches: [] };
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (!raw) return defaults;
      return { ...defaults, ...JSON.parse(raw) };
    } catch {
      return defaults;
    }
  }
  function saveSettings(s) {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
  }
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
    } catch {
    }
  }
  function loadHistory(noteId) {
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (!raw) return [];
      const map = JSON.parse(raw);
      return map[noteId] || [];
    } catch {
      return [];
    }
  }
  const BLOCK_TAGS = /* @__PURE__ */ new Set(["P", "DIV", "H1", "H2", "H3", "LI", "BLOCKQUOTE", "PRE", "UL", "OL", "BR", "HR"]);
  function stripHtml(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    el.querySelectorAll("*").forEach((node) => {
      if (BLOCK_TAGS.has(node.tagName)) node.insertAdjacentText("afterend", "\n");
    });
    return (el.textContent || "")
      .replace(/[ \t]+/g, " ")
      .replace(/[ \t]*\n[ \t]*/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
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
      id: uid(),
      title: "Untitled",
      content: "",
      createdAt: now,
      updatedAt: now,
      pinned: false,
      favorite: false,
      color: null,
      tags: [],
      trashed: false,
      order: now,
      ...overrides
    };
  }
  const fmt = (t) => {
    const now = Date.now();
    const diff = (now - t) / 1e3;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(t).toLocaleDateString();
  };
  const escapeReg = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function highlightHTML(html, query2) {
    if (!query2) return html;
    const el = document.createElement("div");
    el.innerHTML = html;
    const re = new RegExp(escapeReg(query2), "gi");
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
    a.href = url;
    a.download = name;
    a.click();
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
        case "H1":
          return `
# ${kids}
`;
        case "H2":
          return `
## ${kids}
`;
        case "H3":
          return `
### ${kids}
`;
        case "STRONG":
        case "B":
          return `**${kids}**`;
        case "EM":
        case "I":
          return `*${kids}*`;
        case "U":
          return `<u>${kids}</u>`;
        case "BLOCKQUOTE":
          return `
> ${kids}
`;
        case "PRE":
          return `
\`\`\`
${e.textContent}
\`\`\`
`;
        case "CODE":
          return `\`${kids}\``;
        case "HR":
          return `
---
`;
        case "BR":
          return `
`;
        case "UL":
          return `
${Array.from(e.children).map((c) => `- ${walk(c)}`).join("\n")}
`;
        case "OL":
          return `
${Array.from(e.children).map((c, i) => `${i + 1}. ${walk(c)}`).join("\n")}
`;
        case "LI":
          return kids.trim();
        case "P":
        case "DIV":
          return `${kids}
`;
        default:
          return kids;
      }
    };
    return Array.from(el.childNodes).map(walk).join("").replace(/\n{3,}/g, "\n\n").trim();
  }
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
  function $(id) {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Missing #${id}`);
    return el;
  }
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
  const styleSelect = $("styleSelect");
  const fontFamilySelect = $("fontFamilySelect");
  const fontSizeInput = $("fontSizeInput");
  const cpHexInput = $("cpHexInput");
  const cpSwatchGrid = $("cpSwatchGrid");
  const cpSvBox = $("cpSvBox");
  const cpSvCursor = $("cpSvCursor");
  const cpHueSlider = $("cpHueSlider");
  const cpPreview = $("cpPreview");
  const hlHexInput = $("hlHexInput");
  const hlSvBox = $("hlSvBox");
  const hlSvCursor = $("hlSvCursor");
  const hlHueSlider = $("hlHueSlider");
  const hlPreview = $("hlPreview");
  const tagsChips = $("tagsChips");
  const tagInput = $("tagInput");
  const shortcutsOverlay = $("shortcutsOverlay");
  const slashMenu = $("slashMenu");
  const noteLinkMenu = $("noteLinkMenu");
  let noteLinkAnchor = null;
  let currentFontSize = 16;
  let cpHue = 0;
  let cpSat = 0;
  let cpVal = 0;
  let hlHue = 48;
  let hlSat = 0.6;
  let hlVal = 1;
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
  function init() {
    settings = loadSettings();
    notes = loadNotes();
    if (notes.length === 0) {
      const welcome = makeNote({
        title: "Welcome to Tiny Notes",
        content: "<h1>Welcome to Tiny Notes</h1><p>A private space for your thoughts, fast enough to keep up with them.</p><p><strong>Try:</strong></p><ul><li>Press <code>Ctrl/\u2318 K</code> for the command palette</li><li>Format with <code>Ctrl+B</code>, <code>Ctrl+I</code></li><li>Export, or import \u2014 even by dragging a file onto the app</li></ul><blockquote>Just you and your thoughts.</blockquote>"
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
  function getActive() {
    return notes.find((n) => n.id === settings.activeId) || null;
  }
  function setActive(id) {
    settings.activeId = id;
    saveSettings(settings);
    if (isMobile) mobileEditorOpen = true;
    renderAll();
  }
  function updateNote(id, patch) {
    notes = notes.map((n) => n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n);
    saveNotes(notes);
  }
  function persistNotes() {
    saveNotes(notes);
  }
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
      b.onclick = () => {
        query = r;
        searchInput.value = r;
        toggleClearBtn();
        renderAll();
      };
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
      const tags = Array.isArray(n.tags) ? n.tags : [];
      const tagsHtml = tags.length ? `<div class="note-tags">${tags.slice(0, 3).map((t) => `<span class="tag-chip-sm">${escapeHtml(t)}</span>`).join("")}${tags.length > 3 ? `<span class="tag-chip-sm">+${tags.length - 3}</span>` : ""}</div>` : "";
      card.innerHTML = `
      <div class="note-top">
        <span class="note-title">${titleHtml}</span>
        ${n.pinned ? '<svg viewBox="0 0 24 24" class="icon icon-xs pin-mark"><use href="#i-pin"/></svg>' : ""}
        ${n.favorite ? '<svg viewBox="0 0 24 24" class="icon icon-xs fav-mark"><use href="#i-star"/></svg>' : ""}
      </div>
      <div class="note-preview">${escapeHtml(previewText) || "Empty note"}</div>
      ${tagsHtml}
      <div class="note-meta">
        <span>${fmt(n.updatedAt)}</span>
        <div class="note-actions"></div>
      </div>`;
      const actions = card.querySelector(".note-actions");
      if (!showTrash) {
        actions.appendChild(iconBtn("i-pin", "Pin", (e) => {
          e.stopPropagation();
          togglePin(n.id);
        }));
        actions.appendChild(iconBtn("i-star", "Favorite", (e) => {
          e.stopPropagation();
          toggleFav(n.id);
        }));
        actions.appendChild(iconBtn("i-copy", "Duplicate", (e) => {
          e.stopPropagation();
          duplicateNote(n.id);
        }));
        actions.appendChild(iconBtn("i-trash", "Delete", (e) => {
          e.stopPropagation();
          trashNote(n.id);
        }));
      } else {
        actions.appendChild(iconBtn("i-undo", "Restore", (e) => {
          e.stopPropagation();
          restoreNote(n.id);
        }));
        actions.appendChild(iconBtn("i-x", "Delete forever", (e) => {
          e.stopPropagation();
          deleteForever(n.id);
        }));
      }
      card.addEventListener("click", () => setActive(n.id));
      card.addEventListener("dragstart", () => {
        dragId = n.id;
      });
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
    var _a;
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
    editor.setAttribute("data-empty", ((_a = editor.textContent) == null ? void 0 : _a.trim()) ? "" : "Start writing\u2026");
    editor.setAttribute("contenteditable", viewOnly ? "false" : "true");
    titleInput.readOnly = viewOnly;
    document.querySelectorAll("#btnUndo, #btnRedo, #btnHr, #btnColor, #btnTextColor, #btnHighlight, #btnAlign, #btnFontDec, #btnFontInc, #btnInsert, [data-cmd], [data-block]").forEach((b) => {
      b.disabled = viewOnly;
    });
    styleSelect.disabled = viewOnly;
    fontFamilySelect.disabled = viewOnly;
    fontSizeInput.disabled = viewOnly;
    $("btnDeleteAll").toggleAttribute("disabled", viewOnly);
    $("btnPin").classList.toggle("active", !!active.pinned);
    $("btnFav").classList.toggle("fav-active", !!active.favorite);
    $("btnPreview").classList.toggle("active", viewOnly);
    renderTagsUI(active);
    const stats = countStats(active.content);
    statWords.textContent = `${stats.words} words`;
    statChars.textContent = `${stats.chars} chars`;
    statRead.textContent = `~${stats.readingMin} min read`;
    statSaved.innerHTML = savedAt ? `<span class="save-dot"></span>Saved ${fmt(savedAt)}` : "";
    statEdited.textContent = `Edited ${fmt(active.updatedAt)}`;
  }
  function newNote() {
    const n = makeNote();
    notes = [n, ...notes];
    persistNotes();
    showTrash = false;
    setActive(n.id);
    setTimeout(() => editor.focus(), 60);
  }
  function duplicateNote(id) {
    const src = notes.find((n2) => n2.id === (id || settings.activeId));
    if (!src) return;
    const n = makeNote({ title: src.title + " copy", content: src.content, color: src.color, tags: Array.isArray(src.tags) ? [...src.tags] : [] });
    notes = [n, ...notes];
    persistNotes();
    setActive(n.id);
  }
  function trashNote(id) {
    notes = notes.map((n) => n.id === id ? { ...n, trashed: true, trashedAt: Date.now() } : n);
    persistNotes();
    renderAll();
  }
  function restoreNote(id) {
    notes = notes.map((n) => n.id === id ? { ...n, trashed: false } : n);
    persistNotes();
    renderAll();
  }
  function deleteForever(id) {
    notes = notes.filter((n) => n.id !== id);
    persistNotes();
    renderAll();
  }
  function emptyTrash() {
    notes = notes.filter((n) => !n.trashed);
    persistNotes();
    renderAll();
  }
  function togglePin(id) {
    notes = notes.map((n) => n.id === id ? { ...n, pinned: !n.pinned } : n);
    persistNotes();
    renderAll();
  }
  function toggleFav(id) {
    notes = notes.map((n) => n.id === id ? { ...n, favorite: !n.favorite } : n);
    persistNotes();
    renderAll();
  }
  function setColor(id, color) {
    notes = notes.map((n) => n.id === id ? { ...n, color: color || null } : n);
    persistNotes();
    renderAll();
  }
  function setTags(id, tags) {
    notes = notes.map((n) => n.id === id ? { ...n, tags, updatedAt: Date.now() } : n);
    persistNotes();
  }
  function renderTagsUI(active) {
    const tags = Array.isArray(active.tags) ? active.tags : [];
    tagsChips.innerHTML = tags.map((t, i) => `
      <span class="tag-chip">${escapeHtml(t)}<button type="button" class="tag-remove" data-tag-index="${i}" aria-label="Remove tag">\u2715</button></span>
    `).join("");
    tagsChips.querySelectorAll("[data-tag-index]").forEach((btn) => {
      btn.onclick = () => {
        const a = getActive();
        if (!a) return;
        const idx = Number(btn.dataset.tagIndex);
        const next = (a.tags || []).filter((_, i) => i !== idx);
        setTags(a.id, next);
        renderTagsUI({ ...a, tags: next });
        renderNotesList();
      };
    });
  }
  function exportNote(n, kind) {
    const base = (n.title || "note").replace(/[^\w-]+/g, "_");
    if (kind === "txt") download(`${base}.txt`, stripHtml(n.content));
    else if (kind === "md") download(`${base}.md`, `# ${n.title}

${htmlToMarkdown(n.content)}`);
    else download(`${base}.json`, JSON.stringify(n, null, 2), "application/json");
  }
  function exportAll() {
    const payload = { version: 1, exportedAt: Date.now(), notes };
    download(`tinynote-backup-${(/* @__PURE__ */ new Date()).toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), "application/json");
  }
  async function importFile(file) {
    const text = await file.text();
    try {
      if (file.name.endsWith(".json")) {
        const data = JSON.parse(text);
        const incoming = Array.isArray(data) ? data : data.notes || [data];
        const clean = incoming.filter((x) => !!x && typeof x === "object").map((x) => makeNote({
          title: typeof x.title === "string" ? x.title.slice(0, 300) : "Untitled",
          content: sanitizeHtml(typeof x.content === "string" ? x.content : ""),
          pinned: x.pinned === true,
          favorite: x.favorite === true,
          color: typeof x.color === "string" ? x.color.slice(0, 60) : null,
          tags: Array.isArray(x.tags) ? x.tags.filter((t) => typeof t === "string").slice(0, 10).map((t) => t.slice(0, 24)) : [],
          createdAt: typeof x.createdAt === "number" ? x.createdAt : Date.now(),
          updatedAt: typeof x.updatedAt === "number" ? x.updatedAt : Date.now()
        }));
        notes = [...clean, ...notes];
        persistNotes();
        renderAll();
        return;
      }
      const n = makeNote({
        title: file.name.replace(/\.[^.]+$/, ""),
        content: file.name.endsWith(".md") ? `<pre>${text.replace(/</g, "&lt;")}</pre>` : `<p>${text.replace(/</g, "&lt;").replace(/\n/g, "</p><p>")}</p>`
      });
      notes = [n, ...notes];
      persistNotes();
      setActive(n.id);
    } catch (e) {
      alert("Import failed: " + (e instanceof Error ? e.message : String(e)));
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
      persistNotes();
      renderAll();
    }
    dragId = null;
  }
  function onEditorInput() {
    var _a;
    const active = getActive();
    if (!active) return;
    const html = editor.innerHTML;
    editor.setAttribute("data-empty", ((_a = editor.textContent) == null ? void 0 : _a.trim()) ? "" : "Start writing\u2026");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const title = active.title === "Untitled" || !active.title ? autoTitle(html) : active.title;
      updateNote(active.id, { content: html, title });
      savedAt = Date.now();
      renderNotesList();
      renderStatsOnly();
    }, 250);
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => pushHistory(active.id, html), 4e3);
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
  function tryMarkdownShortcut() {
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) return false;
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3) return false;
    let block = node.parentElement;
    while (block && block !== editor && !/^(P|DIV|LI)$/.test(block.tagName)) block = block.parentElement;
    if (!block || block === editor) return false;
    if (block.firstChild !== node) return false;
    const text = node.textContent || "";
    const offset = sel.anchorOffset;
    const before = text.slice(0, offset);
    const resetToOffset = () => {
      node.textContent = text.slice(offset);
      const r = document.createRange();
      r.setStart(node, 0);
      r.collapse(true);
      sel.removeAllRanges();
      sel.addRange(r);
    };
    const headingMap = { "# ": "H1", "## ": "H2", "### ": "H3" };
    if (headingMap[before]) {
      resetToOffset();
      exec("formatBlock", headingMap[before]);
      return true;
    }
    if (before === "> ") {
      resetToOffset();
      exec("formatBlock", "BLOCKQUOTE");
      return true;
    }
    if (before === "- " || before === "* ") {
      resetToOffset();
      exec("insertUnorderedList");
      return true;
    }
    if (/^1\.\s$/.test(before)) {
      resetToOffset();
      exec("insertOrderedList");
      return true;
    }
    return false;
  }
  function openSlashMenu() {
    const rect = getCaretRect();
    if (!rect) return;
    slashMenu.classList.add("open");
    requestAnimationFrame(() => positionPanelAtRect(rect, slashMenu));
  }
  function closeSlashMenu() {
    slashMenu.classList.remove("open");
  }
  function openNoteLinkMenu(query, node, start) {
    const active = getActive();
    const q = (query || "").toLowerCase();
    const candidates = notes
      .filter((n) => !n.trashed && (!active || n.id !== active.id) && (!q || (n.title || "Untitled").toLowerCase().includes(q)))
      .slice(0, 6);
    noteLinkAnchor = { node, start };
    noteLinkMenu.innerHTML = candidates.length
      ? candidates.map((n) => `<button type="button" class="menu-item" data-link-note-id="${n.id}"><svg viewBox="0 0 24 24" class="icon icon-sm"><use href="#i-link"/></svg>${escapeHtml(n.title || "Untitled")}</button>`).join("")
      : '<div class="menu-item-empty">No matching notes</div>';
    noteLinkMenu.querySelectorAll("[data-link-note-id]").forEach((btn) => {
      btn.onclick = () => insertNoteLink(btn.dataset.linkNoteId);
    });
    const rect = getCaretRect();
    if (!rect) return;
    noteLinkMenu.classList.add("open");
    requestAnimationFrame(() => positionPanelAtRect(rect, noteLinkMenu));
  }
  function closeNoteLinkMenu() {
    noteLinkMenu.classList.remove("open");
    noteLinkAnchor = null;
  }
  function insertNoteLink(id) {
    const target = notes.find((n) => n.id === id);
    const anchor = noteLinkAnchor;
    if (!target || !anchor || !anchor.node || !anchor.node.parentNode) {
      closeNoteLinkMenu();
      return;
    }
    const sel = window.getSelection();
    const node = anchor.node;
    const full = node.textContent || "";
    const end = sel && sel.rangeCount && sel.anchorNode === node ? sel.anchorOffset : full.length;
    const range = document.createRange();
    range.setStart(node, Math.min(anchor.start, full.length));
    range.setEnd(node, Math.min(Math.max(end, anchor.start), full.length));
    range.deleteContents();
    const frag = range.createContextualFragment(`<a href="#" class="note-link" data-note-id="${target.id}" contenteditable="false">${escapeHtml(target.title || "Untitled")}</a>\u00a0`);
    range.insertNode(frag);
    range.collapse(false);
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
    closeNoteLinkMenu();
    onEditorInput();
  }
  function checkInlineTriggers() {
    if (viewOnly) return;
    const sel = window.getSelection();
    if (!sel || !sel.isCollapsed || sel.rangeCount === 0) {
      closeSlashMenu();
      closeNoteLinkMenu();
      return;
    }
    const node = sel.anchorNode;
    if (!node || node.nodeType !== 3 || !editor.contains(node)) {
      closeSlashMenu();
      closeNoteLinkMenu();
      return;
    }
    const offset = sel.anchorOffset;
    const text = node.textContent || "";
    const before = text.slice(0, offset);
    let block = node.parentElement;
    while (block && block !== editor && !/^(P|DIV|LI)$/.test(block.tagName)) block = block.parentElement;
    if (block && block !== editor && block.firstChild === node && text === "/" && before === "/") {
      openSlashMenu();
    } else {
      closeSlashMenu();
    }
    const m = /\[\[([^[\]]{0,40})$/.exec(before);
    if (m) {
      openNoteLinkMenu(m[1], node, offset - m[0].length);
    } else {
      closeNoteLinkMenu();
    }
  }
  const TRACKED_CMDS = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"];
  function wrapSelectionWithStyle(styleProp, styleValue) {
    if (viewOnly) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    const span = document.createElement("span");
    span.style.setProperty(styleProp, styleValue);
    try {
      range.surroundContents(span);
    } catch {
      const frag = range.extractContents();
      span.appendChild(frag);
      range.insertNode(span);
    }
    sel.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.addRange(newRange);
    onEditorInput();
  }
  function hsvToHex(h, s, v) {
    const c = v * s;
    const x = c * (1 - Math.abs(h / 60 % 2 - 1));
    const m = v - c;
    let r = 0, g = 0, b = 0;
    if (h < 60) [r, g, b] = [c, x, 0];
    else if (h < 120) [r, g, b] = [x, c, 0];
    else if (h < 180) [r, g, b] = [0, c, x];
    else if (h < 240) [r, g, b] = [0, x, c];
    else if (h < 300) [r, g, b] = [x, 0, c];
    else [r, g, b] = [c, 0, x];
    const toHex = (n) => Math.round((n + m) * 255).toString(16).padStart(2, "0");
    return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  function hexToHsv(hex) {
    const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || "");
    if (!m) return null;
    const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = (g - b) / d % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
      if (h < 0) h += 360;
    }
    const s = max === 0 ? 0 : d / max;
    return { h, s, v: max };
  }
  function updateColorPickerUI() {
    const hex = hsvToHex(cpHue, cpSat, cpVal);
    cpHexInput.value = hex;
    cpPreview.style.background = hex;
    cpSvBox.style.backgroundColor = `hsl(${cpHue},100%,50%)`;
    cpSvCursor.style.left = cpSat * 100 + "%";
    cpSvCursor.style.top = (1 - cpVal) * 100 + "%";
    cpHueSlider.value = String(Math.round(cpHue));
  }
  function applyCurrentPickerColor() {
    wrapSelectionWithStyle("color", hsvToHex(cpHue, cpSat, cpVal));
  }
  function svBoxPointer(e) {
    const rect = cpSvBox.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    let x = (point.clientX - rect.left) / rect.width;
    let y = (point.clientY - rect.top) / rect.height;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    cpSat = x;
    cpVal = 1 - y;
    updateColorPickerUI();
  }
  function updateHighlightPickerUI() {
    const hex = hsvToHex(hlHue, hlSat, hlVal);
    hlHexInput.value = hex;
    hlPreview.style.background = hex;
    hlSvBox.style.backgroundColor = `hsl(${hlHue},100%,50%)`;
    hlSvCursor.style.left = hlSat * 100 + "%";
    hlSvCursor.style.top = (1 - hlVal) * 100 + "%";
    hlHueSlider.value = String(Math.round(hlHue));
  }
  function applyCurrentHighlightColor() {
    wrapSelectionWithStyle("background-color", hsvToHex(hlHue, hlSat, hlVal));
  }
  function hlSvBoxPointer(e) {
    const rect = hlSvBox.getBoundingClientRect();
    const point = e.touches ? e.touches[0] : e;
    let x = (point.clientX - rect.left) / rect.width;
    let y = (point.clientY - rect.top) / rect.height;
    x = Math.max(0, Math.min(1, x));
    y = Math.max(0, Math.min(1, y));
    hlSat = x;
    hlVal = 1 - y;
    updateHighlightPickerUI();
  }
  function getSelectionFontSize() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    if (!node || !editor.contains(node)) return null;
    const size = window.getComputedStyle(node).fontSize;
    return size ? Math.round(parseFloat(size)) : null;
  }
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
      if (node.nodeType === 1 && TRACKED_BLOCKS.includes(node.tagName)) return node.tagName;
      node = node.parentElement;
    }
    return "";
  }
  const INLINE_TAG_MAP = {
    bold: ["B", "STRONG"],
    italic: ["I", "EM"],
    underline: ["U"],
    strikeThrough: ["S", "STRIKE", "DEL"]
  };
  function isInlineCmdActive(cmd) {
    var _a, _b;
    const tags = INLINE_TAG_MAP[cmd];
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    while (node && node !== editor) {
      const el = node;
      if (tags && tags.includes(el.tagName)) return true;
      if (cmd === "insertUnorderedList" && el.tagName === "LI" && ((_a = el.parentElement) == null ? void 0 : _a.tagName) === "UL") return true;
      if (cmd === "insertOrderedList" && el.tagName === "LI" && ((_b = el.parentElement) == null ? void 0 : _b.tagName) === "OL") return true;
      node = el.parentElement;
    }
    return false;
  }
  function updateToolbarActiveStates() {
    const inEditor = !viewOnly && document.activeElement === editor && isSelectionInEditor();
    document.querySelectorAll("[data-cmd]").forEach((b) => {
      let state = false;
      const cmd = b.dataset.cmd || "";
      if (inEditor && TRACKED_CMDS.includes(cmd)) {
        state = isInlineCmdActive(cmd);
      }
      b.classList.toggle("active", state);
    });
    const blockTag = inEditor ? getBlockTag() : "";
    document.querySelectorAll("[data-block]").forEach((b) => {
      b.classList.toggle("active", b.dataset.block === blockTag);
    });
    if (document.activeElement !== styleSelect) {
      styleSelect.value = ["H1", "H2", "H3", "BLOCKQUOTE", "PRE"].includes(blockTag) ? blockTag : "P";
    }
    if (document.activeElement !== fontSizeInput) {
      const size = inEditor ? getSelectionFontSize() : null;
      if (size) {
        currentFontSize = size;
        fontSizeInput.value = String(size);
      }
    }
  }
  function toggleFullscreen() {
    var _a, _b, _c;
    if (!document.fullscreenElement) {
      (_b = (_a = document.documentElement).requestFullscreen) == null ? void 0 : _b.call(_a);
      $("fsLabel").textContent = "Exit fullscreen";
    } else {
      (_c = document.exitFullscreen) == null ? void 0 : _c.call(document);
      $("fsLabel").textContent = "Fullscreen";
    }
  }
  function actionsList() {
    const active = getActive();
    return [
      { label: "New note", hint: "\u2318N", run: () => {
        newNote();
        closeCmd();
      } },
      { label: "Duplicate active", hint: "\u2318D", run: () => {
        duplicateNote();
        closeCmd();
      } },
      { label: "Export active as Markdown", hint: "\u2318S", run: () => {
        if (active) exportNote(active, "md");
        closeCmd();
      } },
      { label: "Export all (backup)", run: () => {
        exportAll();
        closeCmd();
      } },
      { label: "Toggle Zen mode", run: () => {
        zen = !zen;
        renderAll();
        closeCmd();
      } },
      { label: "Toggle Focus mode", run: () => {
        focusMode = !focusMode;
        renderAll();
        closeCmd();
      } },
      { label: "Theme: Light", run: () => {
        settings.theme = "light";
        applyTheme();
        closeCmd();
      } },
      { label: "Theme: Dark", run: () => {
        settings.theme = "dark";
        applyTheme();
        closeCmd();
      } },
      { label: "Theme: AMOLED", run: () => {
        settings.theme = "amoled";
        applyTheme();
        closeCmd();
      } },
      { label: "Theme: Sepia", run: () => {
        settings.theme = "sepia";
        applyTheme();
        closeCmd();
      } }
    ];
  }
  function openCmd() {
    cmdOverlay.classList.remove("hidden");
    cmdInput.value = "";
    cmdInput.focus();
    renderCmd("");
  }
  function closeCmd() {
    cmdOverlay.classList.add("hidden");
  }
  function renderCmd(q) {
    const ql = q.toLowerCase();
    const actions = actionsList().filter((a) => a.label.toLowerCase().includes(ql));
    const noteList = q ? notes.filter((n) => n.title.toLowerCase().includes(ql) || stripHtml(n.content).toLowerCase().includes(ql)).slice(0, 8) : notes.slice(0, 6);
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
        row.onclick = () => {
          setActive(n.id);
          closeCmd();
        };
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
      const restoreBtn = item.querySelector(".history-restore");
      restoreBtn.onclick = () => {
        updateNote(active.id, { content: v.c });
        editor.innerHTML = v.c;
        historyOverlay.classList.add("hidden");
        renderAll();
      };
      historyBody.appendChild(item);
    });
    historyOverlay.classList.remove("hidden");
  }
  const floatingMenus = [];
  let floatingScrim;
  function isMobileViewport() {
    return window.matchMedia("(max-width: 720px)").matches;
  }
  function positionFloatingPanel(trigger, panel) {
    const r = trigger.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const w = panelRect.width || 220;
    let left = r.right - w;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = r.bottom + 6;
    const h = panelRect.height || 0;
    if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  function closeAllFloating() {
    floatingMenus.forEach(({ panel }) => panel.classList.remove("open"));
    floatingScrim.classList.remove("show");
    if (slashMenu) slashMenu.classList.remove("open");
    if (noteLinkMenu) {
      noteLinkMenu.classList.remove("open");
      noteLinkAnchor = null;
    }
  }
  function positionPanelAtRect(rect, panel) {
    const panelRect = panel.getBoundingClientRect();
    const w = panelRect.width || 220;
    let left = rect.left;
    left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
    let top = rect.bottom + 6;
    const h = panelRect.height || 0;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  function getCaretRect() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    range.collapse(true);
    const rects = range.getClientRects();
    if (rects.length) return rects[0];
    return range.startContainer.nodeType === 1 ? range.startContainer.getBoundingClientRect() : null;
  }
  function openFloatingMenu(trigger, panel) {
    closeAllFloating();
    const mobile = isMobileViewport();
    panel.classList.toggle("sheet-mode", mobile);
    if (mobile) {
      floatingScrim.classList.add("show");
    } else {
      positionFloatingPanel(trigger, panel);
    }
    requestAnimationFrame(() => panel.classList.add("open"));
  }
  function registerFloatingMenu(triggerId, panelId) {
    const trigger = $(triggerId);
    const panel = $(panelId);
    document.body.appendChild(panel);
    floatingMenus.push({ trigger, panel });
    trigger.addEventListener("mousedown", (e) => e.preventDefault());
    panel.addEventListener("mousedown", (e) => e.preventDefault());
    trigger.addEventListener("click", (e) => {
      e.stopPropagation();
      if (panel.classList.contains("open")) closeAllFloating();
      else openFloatingMenu(trigger, panel);
    });
    panel.addEventListener("click", (e) => e.stopPropagation());
    return panel;
  }
  function toggleClearBtn() {
    btnClearSearch.classList.toggle("hidden", !query);
  }
  function bindEvents() {
    document.querySelectorAll(".toolbar button").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault());
    });
    $("btnNewNoteTop").onclick = newNote;
    $("btnEmptyNew").onclick = newNote;
    searchInput.addEventListener("input", (e) => {
      query = e.target.value;
      toggleClearBtn();
      renderAll();
    });
    searchInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && query.trim()) {
        settings.recentSearches = [query, ...settings.recentSearches.filter((x) => x !== query)].slice(0, 6);
        saveSettings(settings);
        renderRecentSearches();
      }
    });
    btnClearSearch.onclick = () => {
      query = "";
      searchInput.value = "";
      toggleClearBtn();
      renderAll();
    };
    tabAll.onclick = () => {
      showTrash = false;
      renderAll();
    };
    tabTrash.onclick = () => {
      showTrash = true;
      renderAll();
    };
    sortSelect.onchange = (e) => {
      settings.sortBy = e.target.value;
      saveSettings(settings);
      renderAll();
    };
    document.querySelectorAll(".theme-chip").forEach((chip) => {
      chip.onclick = () => {
        settings.theme = chip.dataset.theme || "light";
        applyTheme();
      };
    });
    $("btnCmdPalette2").onclick = openCmd;
    titleInput.addEventListener("input", () => {
      const active = getActive();
      if (!active) return;
      updateNote(active.id, { title: titleInput.value });
      renderNotesList();
    });
    $("btnUndo").onclick = () => exec("undo");
    $("btnRedo").onclick = () => exec("redo");
    document.querySelectorAll("[data-cmd]").forEach((b) => {
      b.onclick = () => exec(b.dataset.cmd || "");
    });
    document.querySelectorAll("[data-block]").forEach((b) => {
      b.onclick = () => exec("formatBlock", b.dataset.block);
    });
    $("btnHr").onclick = () => exec("insertHorizontalRule");
    floatingScrim = document.createElement("div");
    floatingScrim.className = "floating-scrim";
    document.body.appendChild(floatingScrim);
    floatingScrim.addEventListener("click", closeAllFloating);
    const colorPopover = registerFloatingMenu("btnColor", "colorPopover");
    const moreMenu = registerFloatingMenu("btnMore", "moreMenu");
    const alignMenu = registerFloatingMenu("btnAlign", "alignMenu");
    const alignIcon = $("alignIcon");
    alignMenu.querySelectorAll("[data-align]").forEach((btn) => {
      btn.onclick = () => {
        exec(btn.dataset.align);
        alignIcon.setAttribute("href", `#${btn.dataset.alignIcon}`);
        closeAllFloating();
      };
    });
    const textColorPopover = registerFloatingMenu("btnTextColor", "textColorPopover");
    const highlightColorPopover = registerFloatingMenu("btnHighlight", "highlightColorPopover");
    const insertMenu = registerFloatingMenu("btnInsert", "insertMenu");
    colorPopover.querySelectorAll(".swatch").forEach((sw) => {
      sw.onclick = () => {
        const active = getActive();
        if (active) setColor(active.id, sw.dataset.color || "");
        closeAllFloating();
      };
    });
    textColorPopover.querySelectorAll("[data-tcolor]").forEach((sw) => {
      sw.onclick = () => {
        const val = sw.dataset.tcolor || "inherit";
        wrapSelectionWithStyle("color", val);
        if (val !== "inherit") {
          const hsv = hexToHsv(val);
          if (hsv) {
            cpHue = hsv.h;
            cpSat = hsv.s;
            cpVal = hsv.v;
            updateColorPickerUI();
          }
        }
        closeAllFloating();
      };
    });
    cpHexInput.addEventListener("change", () => {
      let v = cpHexInput.value.trim();
      if (v && !v.startsWith("#")) v = "#" + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        const hsv = hexToHsv(v);
        if (hsv) {
          cpHue = hsv.h;
          cpSat = hsv.s;
          cpVal = hsv.v;
          updateColorPickerUI();
        }
        wrapSelectionWithStyle("color", v);
      } else {
        cpHexInput.value = hsvToHex(cpHue, cpSat, cpVal);
      }
    });
    cpHueSlider.addEventListener("input", () => {
      cpHue = parseFloat(cpHueSlider.value) || 0;
      updateColorPickerUI();
      applyCurrentPickerColor();
    });
    let cpDragging = false;
    cpSvBox.addEventListener("mousedown", (e) => {
      cpDragging = true;
      svBoxPointer(e);
      applyCurrentPickerColor();
    });
    cpSvBox.addEventListener("touchstart", (e) => {
      cpDragging = true;
      svBoxPointer(e);
      applyCurrentPickerColor();
    }, { passive: true });
    window.addEventListener("mousemove", (e) => {
      if (cpDragging) svBoxPointer(e);
    });
    window.addEventListener("touchmove", (e) => {
      if (cpDragging) svBoxPointer(e);
    }, { passive: true });
    window.addEventListener("mouseup", () => {
      if (cpDragging) {
        cpDragging = false;
        applyCurrentPickerColor();
      }
    });
    window.addEventListener("touchend", () => {
      if (cpDragging) {
        cpDragging = false;
        applyCurrentPickerColor();
      }
    });
    $("btnTextColor").addEventListener("click", () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && !sel.isCollapsed) {
        let node = sel.getRangeAt(0).startContainer;
        if (node.nodeType === 3) node = node.parentElement;
        if (node && editor.contains(node)) {
          const rgb = window.getComputedStyle(node).color;
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(rgb);
          if (m) {
            const hex = "#" + [1, 2, 3].map((i) => (+m[i]).toString(16).padStart(2, "0")).join("");
            const hsv = hexToHsv(hex);
            if (hsv) {
              cpHue = hsv.h;
              cpSat = hsv.s;
              cpVal = hsv.v;
            }
          }
        }
      }
      updateColorPickerUI();
    });
    updateColorPickerUI();
    const applyFontSize = (px) => {
      px = Math.max(8, Math.min(96, Math.round(px)));
      currentFontSize = px;
      fontSizeInput.value = String(px);
      wrapSelectionWithStyle("font-size", px + "px");
    };
    $("btnFontDec").onclick = () => applyFontSize((getSelectionFontSize() || currentFontSize) - 1);
    $("btnFontInc").onclick = () => applyFontSize((getSelectionFontSize() || currentFontSize) + 1);
    fontSizeInput.addEventListener("change", () => {
      const v = parseInt(fontSizeInput.value, 10);
      if (!isNaN(v)) applyFontSize(v);
      else fontSizeInput.value = String(currentFontSize);
    });
    fontSizeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") fontSizeInput.blur();
    });
    styleSelect.addEventListener("change", () => {
      const val = styleSelect.value;
      exec("formatBlock", val === "P" ? "P" : val);
    });
    fontFamilySelect.addEventListener("change", () => {
      const val = fontFamilySelect.value;
      wrapSelectionWithStyle("font-family", val || "inherit");
    });
    highlightColorPopover.querySelectorAll("[data-hcolor]").forEach((sw) => {
      sw.onclick = () => {
        const val = sw.dataset.hcolor || "inherit";
        wrapSelectionWithStyle("background-color", val);
        if (val !== "inherit") {
          const hsv = hexToHsv(val);
          if (hsv) {
            hlHue = hsv.h;
            hlSat = hsv.s;
            hlVal = hsv.v;
            updateHighlightPickerUI();
          }
        }
        closeAllFloating();
      };
    });
    hlHexInput.addEventListener("change", () => {
      let v = hlHexInput.value.trim();
      if (v && !v.startsWith("#")) v = "#" + v;
      if (/^#[0-9a-fA-F]{6}$/.test(v)) {
        const hsv = hexToHsv(v);
        if (hsv) {
          hlHue = hsv.h;
          hlSat = hsv.s;
          hlVal = hsv.v;
          updateHighlightPickerUI();
        }
        wrapSelectionWithStyle("background-color", v);
      } else {
        hlHexInput.value = hsvToHex(hlHue, hlSat, hlVal);
      }
    });
    hlHueSlider.addEventListener("input", () => {
      hlHue = parseFloat(hlHueSlider.value) || 0;
      updateHighlightPickerUI();
      applyCurrentHighlightColor();
    });
    let hlDragging = false;
    hlSvBox.addEventListener("mousedown", (e) => {
      hlDragging = true;
      hlSvBoxPointer(e);
      applyCurrentHighlightColor();
    });
    hlSvBox.addEventListener("touchstart", (e) => {
      hlDragging = true;
      hlSvBoxPointer(e);
      applyCurrentHighlightColor();
    }, { passive: true });
    window.addEventListener("mousemove", (e) => {
      if (hlDragging) hlSvBoxPointer(e);
    });
    window.addEventListener("touchmove", (e) => {
      if (hlDragging) hlSvBoxPointer(e);
    }, { passive: true });
    window.addEventListener("mouseup", () => {
      if (hlDragging) {
        hlDragging = false;
        applyCurrentHighlightColor();
      }
    });
    window.addEventListener("touchend", () => {
      if (hlDragging) {
        hlDragging = false;
        applyCurrentHighlightColor();
      }
    });
    updateHighlightPickerUI();
    tagInput.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      e.preventDefault();
      const active = getActive();
      if (!active) return;
      const val = tagInput.value.trim().replace(/^#+/, "").slice(0, 24);
      if (!val) return;
      const existing = Array.isArray(active.tags) ? active.tags : [];
      if (existing.some((t) => t.toLowerCase() === val.toLowerCase())) {
        tagInput.value = "";
        return;
      }
      const next = [...existing, val].slice(0, 10);
      setTags(active.id, next);
      renderTagsUI({ ...active, tags: next });
      renderNotesList();
      tagInput.value = "";
    });
    $("btnShortcutsHelp").onclick = () => {
      closeAllFloating();
      shortcutsOverlay.classList.remove("hidden");
    };
    shortcutsOverlay.addEventListener("click", (e) => {
      if (e.target === shortcutsOverlay) shortcutsOverlay.classList.add("hidden");
    });
    const templatesMenu = registerFloatingMenu("btnTemplates", "templatesMenu");
    const TEMPLATES = {
      blank: { title: "", content: "" },
      meeting: {
        title: "Meeting notes",
        content: "<h2>Meeting notes</h2><p><strong>Date:</strong> &nbsp;<strong>Attendees:</strong> </p><h3>Agenda</h3><ul><li>&nbsp;</li></ul><h3>Notes</h3><p>&nbsp;</p><h3>Action items</h3><ul class=\"checklist\"><li><label><input type=\"checkbox\"> &nbsp;</label></li></ul>"
      },
      todo: {
        title: "To-do list",
        content: "<h2>To-do list</h2><ul class=\"checklist\"><li><label><input type=\"checkbox\"> Task one</label></li><li><label><input type=\"checkbox\"> Task two</label></li><li><label><input type=\"checkbox\"> Task three</label></li></ul>"
      },
      journal: {
        title: "Journal entry",
        content: "<h2>Journal entry</h2><p><strong>Today I\u2019m grateful for:</strong></p><p>&nbsp;</p><p><strong>What happened today:</strong></p><p>&nbsp;</p><p><strong>Tomorrow I want to:</strong></p><p>&nbsp;</p>"
      }
    };
    templatesMenu.querySelectorAll("[data-template]").forEach((btn) => {
      btn.onclick = () => {
        closeAllFloating();
        const t = TEMPLATES[btn.dataset.template] || TEMPLATES.blank;
        const n = makeNote({ title: t.title, content: t.content });
        notes = [n, ...notes];
        persistNotes();
        showTrash = false;
        setActive(n.id);
        setTimeout(() => titleInput.focus(), 60);
      };
    });
    $("mInsertLink").onclick = () => {
      closeAllFloating();
      const url = prompt("Link URL (https://\u2026)");
      if (!url) return;
      editor.focus();
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && editor.contains(sel.anchorNode)) {
        document.execCommand("createLink", false, url);
      } else {
        document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`);
      }
      onEditorInput();
    };
    $("mInsertImage").onclick = () => {
      closeAllFloating();
      const url = prompt("Image URL (https://\u2026)");
      if (!url) return;
      editor.focus();
      document.execCommand("insertImage", false, url);
      onEditorInput();
    };
    function insertImageFile(file) {
      if (!file || !file.type || !file.type.startsWith("image/")) return;
      if (file.size > 5 * 1024 * 1024) {
        alert("Image is too large \u2014 please use one under 5MB.");
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        editor.focus();
        document.execCommand("insertImage", false, reader.result);
        onEditorInput();
      };
      reader.readAsDataURL(file);
    }
    function stripPastedColors(html) {
      const template = document.createElement("template");
      template.innerHTML = html;
      template.content.querySelectorAll("[style]").forEach((el) => {
        el.style.removeProperty("color");
        el.style.removeProperty("background-color");
        el.style.removeProperty("background");
        if (!el.getAttribute("style").trim()) el.removeAttribute("style");
      });
      template.content.querySelectorAll("font").forEach((el) => el.removeAttribute("color"));
      return template.innerHTML;
    }
    editor.addEventListener("paste", (e) => {
      if (viewOnly) return;
      const cd = e.clipboardData;
      if (!cd) return;
      const items = cd.items;
      const imageItem = items ? Array.from(items).find((it) => it.type && it.type.startsWith("image/")) : null;
      if (imageItem) {
        e.preventDefault();
        insertImageFile(imageItem.getAsFile());
        return;
      }
      const html = cd.getData("text/html");
      if (html) {
        e.preventDefault();
        const clean = stripPastedColors(sanitizeHtml(html));
        document.execCommand("insertHTML", false, clean);
        onEditorInput();
      }
    });
    $("mInsertChecklist").onclick = () => {
      closeAllFloating();
      if (viewOnly) return;
      editor.focus();
      document.execCommand("insertHTML", false, '<ul class="checklist"><li><label><input type="checkbox"> Untitled task</label></li></ul><p><br></p>');
      onEditorInput();
    };
    $("mInsertTable").onclick = () => {
      closeAllFloating();
      if (viewOnly) return;
      editor.focus();
      const rows = 3, cols = 3;
      let html = '<table class="note-table"><tbody>';
      for (let r = 0; r < rows; r++) {
        html += "<tr>";
        for (let c = 0; c < cols; c++) html += "<td>&nbsp;</td>";
        html += "</tr>";
      }
      html += "</tbody></table><p><br></p>";
      document.execCommand("insertHTML", false, html);
      onEditorInput();
    };
    $("btnPin").onclick = () => {
      const a = getActive();
      if (a) togglePin(a.id);
    };
    $("btnFav").onclick = () => {
      const a = getActive();
      if (a) toggleFav(a.id);
    };
    $("btnPreview").onclick = () => {
      viewOnly = !viewOnly;
      renderEditorArea();
      updateToolbarActiveStates();
    };
    $("btnHistory").onclick = openHistory;
    $("btnCloseHistory").onclick = () => historyOverlay.classList.add("hidden");
    historyOverlay.onclick = (e) => {
      if (e.target === historyOverlay) historyOverlay.classList.add("hidden");
    };
    $("mExportTxt").onclick = () => {
      const a = getActive();
      if (a) exportNote(a, "txt");
      closeAllFloating();
    };
    $("mExportMd").onclick = () => {
      const a = getActive();
      if (a) exportNote(a, "md");
      closeAllFloating();
    };
    $("mExportJson").onclick = () => {
      const a = getActive();
      if (a) exportNote(a, "json");
      closeAllFloating();
    };
    function ensureJsPDF() {
      if (window.jspdf && window.jspdf.jsPDF) return Promise.resolve(window.jspdf.jsPDF);
      if (window.__jspdfLoading) return window.__jspdfLoading;
      window.__jspdfLoading = new Promise((resolve, reject) => {
        const s = document.createElement("script");
        s.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js";
        s.onload = () => {
          if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
          else reject(new Error("jsPDF failed to load"));
        };
        s.onerror = () => reject(new Error("jsPDF failed to load"));
        document.head.appendChild(s);
      });
      return window.__jspdfLoading;
    }
    function printFallback(active) {
      const prevTitle = document.title;
      document.title = (active.title || "Untitled") + " \u2014 Tiny Notes";
      document.body.classList.add("printing-note");
      window.print();
      setTimeout(() => {
        document.body.classList.remove("printing-note");
        document.title = prevTitle;
      }, 400);
    }
    $("mExportPdf").onclick = async () => {
      closeAllFloating();
      const active = getActive();
      if (!active) return;
      try {
        const JsPDF = await ensureJsPDF();
        const doc = new JsPDF({ unit: "pt", format: "a4" });
        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        const marginX = 48;
        const marginY = 56;
        const maxWidth = pageWidth - marginX * 2;
        let y = marginY;
        doc.setFont("helvetica", "bold");
        doc.setFontSize(18);
        doc.splitTextToSize(active.title || "Untitled", maxWidth).forEach((line) => {
          doc.text(line, marginX, y);
          y += 24;
        });
        y += 10;
        doc.setDrawColor(220);
        doc.line(marginX, y, pageWidth - marginX, y);
        y += 20;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(11);
        const bodyText = stripHtml(active.content) || " ";
        bodyText.split("\n").forEach((para) => {
          if (para.trim() === "") {
            y += 14;
            return;
          }
          doc.splitTextToSize(para, maxWidth).forEach((line) => {
            if (y > pageHeight - marginY) {
              doc.addPage();
              y = marginY;
            }
            doc.text(line, marginX, y);
            y += 16;
          });
          y += 6;
        });
        const base = (active.title || "note").replace(/[^\w-]+/g, "_") || "note";
        doc.save(`${base}.pdf`);
      } catch {
        printFallback(active);
      }
    };
    $("mExportDoc").onclick = () => {
      closeAllFloating();
      const active = getActive();
      if (!active) return;
      const base = (active.title || "note").replace(/[^\w-]+/g, "_") || "note";
      const bodyHtml = active.content || "<p></p>";
      const doc = `<!DOCTYPE html><html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head><meta charset="utf-8"><title>${escapeHtml(active.title || "Untitled")}</title>
<style>body{font-family:Calibri,Arial,sans-serif;font-size:12pt;} table{border-collapse:collapse;} td,th{border:1px solid #999;padding:4px 8px;}</style>
</head><body>
<h1>${escapeHtml(active.title || "Untitled")}</h1>
${bodyHtml}
</body></html>`;
      const blob = new Blob(["\ufeff", doc], { type: "application/msword" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${base}.doc`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2e3);
    };
    $("mExportAll").onclick = () => {
      exportAll();
      closeAllFloating();
    };
    $("mImport").onclick = () => {
      importFileInput.click();
      closeAllFloating();
    };
    $("mZen").onclick = () => {
      zen = !zen;
      renderAll();
      closeAllFloating();
    };
    $("mFocus").onclick = () => {
      focusMode = !focusMode;
      renderAll();
      closeAllFloating();
    };
    $("mFullscreen").onclick = () => {
      toggleFullscreen();
      closeAllFloating();
    };
    $("btnCopyAll").onclick = async () => {
      const active = getActive();
      if (!active) return;
      const text = stripHtml(active.content);
      const html = active.content || "";
      const flash = () => {
        const btn = $("btnCopyAll");
        btn.classList.add("fab-success");
        setTimeout(() => btn.classList.remove("fab-success"), 900);
      };
      const legacyCopy = () => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          flash();
        } catch {
        }
        ta.remove();
      };
      try {
        if (navigator.clipboard && window.ClipboardItem) {
          const item = new ClipboardItem({
            "text/plain": new Blob([text], { type: "text/plain" }),
            "text/html": new Blob([html], { type: "text/html" })
          });
          await navigator.clipboard.write([item]);
        } else if (navigator.clipboard) {
          await navigator.clipboard.writeText(text);
        } else {
          legacyCopy();
          return;
        }
        flash();
      } catch {
        try {
          await navigator.clipboard.writeText(text);
          flash();
        } catch {
          legacyCopy();
        }
      }
    };
    $("btnDeleteAll").onclick = () => {
      var _a;
      const active = getActive();
      if (!active || viewOnly) return;
      if (!active.content.trim() && !((_a = editor.textContent) == null ? void 0 : _a.trim())) return;
      if (!confirm("Delete all text in this note? This can't be undone.")) return;
      editor.innerHTML = "";
      updateNote(active.id, { content: "" });
      editor.setAttribute("data-empty", "Start writing\u2026");
      renderNotesList();
      renderStatsOnly();
      editor.focus();
    };
    importFileInput.addEventListener("change", (e) => {
      const files = e.target.files;
      if (files) Array.from(files).forEach((f) => importFile(f));
      e.target.value = "";
    });
    document.addEventListener("click", closeAllFloating);
    window.addEventListener("resize", closeAllFloating);
    editor.addEventListener("input", onEditorInput);
    editor.addEventListener("input", () => {
      try {
        checkInlineTriggers();
      } catch {
      }
    });
    slashMenu.addEventListener("mousedown", (e) => e.preventDefault());
    slashMenu.addEventListener("click", (e) => e.stopPropagation());
    noteLinkMenu.addEventListener("mousedown", (e) => e.preventDefault());
    noteLinkMenu.addEventListener("click", (e) => e.stopPropagation());
    editor.addEventListener("click", (e) => {
      const link = e.target.closest && e.target.closest(".note-link");
      if (!link) return;
      e.preventDefault();
      const id = link.dataset.noteId;
      if (notes.some((n) => n.id === id && !n.trashed)) {
        setActive(id);
      } else {
        alert("That note no longer exists.");
      }
    });
    slashMenu.querySelectorAll("[data-slash]").forEach((btn) => {
      btn.onclick = () => {
        const sel = window.getSelection();
        const node = sel && sel.anchorNode;
        closeSlashMenu();
        if (node && node.nodeType === 3 && node.textContent === "/") {
          node.textContent = "";
          const r = document.createRange();
          r.setStart(node, 0);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
        }
        editor.focus();
        const type = btn.dataset.slash;
        if (type === "h1") exec("formatBlock", "H1");
        else if (type === "h2") exec("formatBlock", "H2");
        else if (type === "h3") exec("formatBlock", "H3");
        else if (type === "quote") exec("formatBlock", "BLOCKQUOTE");
        else if (type === "code") exec("formatBlock", "PRE");
        else if (type === "ul") exec("insertUnorderedList");
        else if (type === "ol") exec("insertOrderedList");
        else if (type === "checklist") {
          document.execCommand("insertHTML", false, '<ul class="checklist"><li><label><input type="checkbox"> Untitled task</label></li></ul><p><br></p>');
          onEditorInput();
        } else if (type === "table") {
          let html = '<table class="note-table"><tbody>';
          for (let r2 = 0; r2 < 3; r2++) {
            html += "<tr>";
            for (let c = 0; c < 3; c++) html += "<td>&nbsp;</td>";
            html += "</tr>";
          }
          html += "</tbody></table><p><br></p>";
          document.execCommand("insertHTML", false, html);
          onEditorInput();
        } else if (type === "hr") {
          document.execCommand("insertHTML", false, "<hr><p><br></p>");
          onEditorInput();
        } else if (type === "link") {
          document.execCommand("insertText", false, "[[");
          try {
            checkInlineTriggers();
          } catch {
          }
        }
      };
    });
    editor.addEventListener("keyup", updateToolbarActiveStates);
    editor.addEventListener("keyup", (e) => {
      if (e.key === " " && !viewOnly) {
        try {
          if (tryMarkdownShortcut()) onEditorInput();
        } catch {
        }
      }
    });
    editor.addEventListener("mouseup", updateToolbarActiveStates);
    editor.addEventListener("focus", updateToolbarActiveStates);
    editor.addEventListener("blur", updateToolbarActiveStates);
    document.addEventListener("selectionchange", updateToolbarActiveStates);
    document.querySelectorAll(".toolbar .tool-btn").forEach((b) => {
      b.addEventListener("mousedown", (e) => e.preventDefault());
    });
    cmdInput.addEventListener("input", (e) => renderCmd(e.target.value));
    cmdOverlay.addEventListener("click", (e) => {
      if (e.target === cmdOverlay) closeCmd();
    });
    const resizeHandle = $("resizeHandle");
    resizeHandle.addEventListener("mousedown", () => {
      resizing = true;
    });
    window.addEventListener("mousemove", (e) => {
      if (!resizing) return;
      const w = Math.max(220, Math.min(480, e.clientX));
      settings.sidebarWidth = w;
      sidebar.style.width = w + "px";
    });
    window.addEventListener("mouseup", () => {
      if (resizing) {
        resizing = false;
        saveSettings(settings);
      }
    });
    window.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        cmdOverlay.classList.contains("hidden") ? openCmd() : closeCmd();
        return;
      }
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault();
        newNote();
        return;
      }
      if (mod && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInput.focus();
        return;
      }
      if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateNote();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        const a = getActive();
        if (a) exportNote(a, "md");
        return;
      }
      if (mod && e.key.toLowerCase() === "a") {
        const t = document.activeElement;
        const isTextField = !!t && (t === editor || t.isContentEditable || t.tagName === "INPUT" || t.tagName === "TEXTAREA");
        if (!isTextField) {
          e.preventDefault();
          const a = getActive();
          if (a && !editorView.classList.contains("hidden")) {
            editor.focus();
            const range = document.createRange();
            range.selectNodeContents(editor);
            const sel = window.getSelection();
            if (sel) {
              sel.removeAllRanges();
              sel.addRange(range);
            }
          }
        }
        return;
      }
      if (e.key === "Escape") {
        closeCmd();
        historyOverlay.classList.add("hidden");
        shortcutsOverlay.classList.add("hidden");
        closeAllFloating();
        closeSlashMenu();
        closeNoteLinkMenu();
      }
    });
    document.addEventListener("fullscreenchange", () => {
      $("fsLabel").textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    });
    $("btnMobileBack").onclick = () => {
      mobileEditorOpen = false;
      renderMobileLayout();
    };
    mobileMql.addEventListener("change", (e) => {
      isMobile = e.matches;
      renderMobileLayout();
    });
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
      const dropInEditor = !viewOnly && !!getActive() && editor.contains(e.target);
      files.forEach((f) => {
        if (f.type && f.type.startsWith("image/")) {
          if (dropInEditor) insertImageFile(f);
        } else {
          importFile(f);
        }
      });
    });
  }
  init();
})();
