(() => {
  // ===================== Service Worker Registration =====================
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('./service-worker.js').catch(() => {});
    });
  }

  // ===================== Storage =====================
  const NOTES_KEY = "tinynote.notes.v1";
  const SETTINGS_KEY = "tinynote.settings.v1";
  const HISTORY_KEY = "tinynote.history.v1";

  const uid = () => "n_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  function loadNotes() {
    try { const r = localStorage.getItem(NOTES_KEY); return r ? JSON.parse(r) : []; } catch { return []; }
  }
  function saveNotes(list) { localStorage.setItem(NOTES_KEY, JSON.stringify(list)); }
  function loadSettings() {
    const d = { theme: "light", sortBy: "updated", sidebarWidth: 300, activeId: null, recentSearches: [] };
    try { const r = localStorage.getItem(SETTINGS_KEY); return r ? { ...d, ...JSON.parse(r) } : d; } catch { return d; }
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
    } catch {}
  }
  function loadHistory(noteId) {
    try { const r = localStorage.getItem(HISTORY_KEY); return r ? (JSON.parse(r)[noteId] || []) : []; } catch { return []; }
  }

  // ===================== Helpers =====================
  const BLOCK_TAGS = new Set(["P","DIV","H1","H2","H3","LI","BLOCKQUOTE","PRE","UL","OL","BR","HR","TD","TH"]);
  function stripHtml(html) {
    const el = document.createElement("div");
    el.innerHTML = html;
    el.querySelectorAll("*").forEach(n => {
      if (BLOCK_TAGS.has(n.tagName)) n.insertAdjacentText("afterend", "\n");
    });
    return (el.textContent || "").replace(/[ \t]+/g, " ").replace(/ *\n */g, "\n").trim();
  }
  function autoTitle(content) {
    const text = stripHtml(content).trim();
    if (!text) return "Untitled";
    return text.split(/\n/)[0].trim().slice(0, 80) || "Untitled";
  }
  function countStats(content) {
    const text = stripHtml(content).trim();
    const chars = text.length;
    const words = text ? text.split(/\s+/).filter(Boolean).length : 0;
    return { chars, words, readingMin: Math.max(1, Math.round(words / 200)) };
  }
  function makeNote(overrides = {}) {
    const now = Date.now();
    return { id: uid(), title: "Untitled", content: "", createdAt: now, updatedAt: now, pinned: false, favorite: false, color: null, trashed: false, order: now, ...overrides };
  }
  const fmt = t => {
    const diff = (Date.now() - t) / 1000;
    if (diff < 60) return "just now";
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 86400 * 7) return `${Math.floor(diff / 86400)}d ago`;
    return new Date(t).toLocaleDateString();
  };
  const escReg = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  function escapeHtml(s) { const d = document.createElement("div"); d.textContent = s; return d.innerHTML; }
  function highlightHTML(html, q) {
    if (!q) return html;
    const el = document.createElement("div"); el.innerHTML = html;
    const re = new RegExp(escReg(q), "gi");
    const walk = node => {
      if (node.nodeType === 3) {
        const text = node.nodeValue || "";
        if (!re.test(text)) return; re.lastIndex = 0;
        const frag = document.createDocumentFragment();
        let last = 0;
        text.replace(re, (m, i) => {
          frag.appendChild(document.createTextNode(text.slice(last, i)));
          const mk = document.createElement("mark"); mk.className = "search-hit"; mk.textContent = m;
          frag.appendChild(mk); last = i + m.length; return m;
        });
        frag.appendChild(document.createTextNode(text.slice(last)));
        node.replaceWith(frag);
      } else if (node.nodeType === 1 && node.tagName !== "MARK") Array.from(node.childNodes).forEach(walk);
    };
    Array.from(el.childNodes).forEach(walk);
    return el.innerHTML;
  }
  function download(name, content, type = "text/plain") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = Object.assign(document.createElement("a"), { href: url, download: name });
    a.click(); URL.revokeObjectURL(url);
  }
  function htmlToMarkdown(html) {
    const el = document.createElement("div"); el.innerHTML = html;
    const walk = node => {
      if (node.nodeType === 3) return node.nodeValue || "";
      if (node.nodeType !== 1) return "";
      const e = node, kids = Array.from(e.childNodes).map(walk).join("");
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
        case "UL": return `\n${Array.from(e.children).map(c => `- ${walk(c)}`).join("\n")}\n`;
        case "OL": return `\n${Array.from(e.children).map((c, i) => `${i + 1}. ${walk(c)}`).join("\n")}\n`;
        case "LI": return kids.trim();
        case "P": case "DIV": return `${kids}\n`;
        default: return kids;
      }
    };
    return Array.from(el.childNodes).map(walk).join("").replace(/\n{3,}/g, "\n\n").trim();
  }

  // ===================== State =====================
  let notes = [], settings = loadSettings(), query = "", showTrash = false;
  let zen = false, focusMode = false, viewOnly = false, savedAt = null;
  let dragId = null, saveTimer = null, historyTimer = null, resizing = false, dragDepth = 0;
  let currentFontSizePx = 16;
  let currentTextColor = "#000000";
  let currentHighlightColor = "#FFFF00";
  const mobileMql = window.matchMedia("(max-width: 720px)");
  let isMobile = mobileMql.matches, mobileEditorOpen = false;

  // ===================== DOM refs =====================
  const $ = id => { const el = document.getElementById(id); if (!el) throw new Error(`Missing #${id}`); return el; };
  const root = $("app");
  const sidebar = $("sidebar");
  const searchInput = $("searchInput");
  const btnClearSearch = $("btnClearSearch");
  const recentSearchesEl = $("recentSearches");
  const tabAll = $("tabAll"), tabTrash = $("tabTrash");
  const sortSelect = $("sortSelect");
  const notesListEl = $("notesList");
  const mainPanel = $("mainPanel");
  const editorView = $("editorView");
  const emptyState = $("emptyState");
  const titleInput = $("titleInput");
  const editor = $("editor");
  const statWords = $("statWords"), statChars = $("statChars"), statRead = $("statRead"), statSaved = $("statSaved"), statEdited = $("statEdited");
  const importFileInput = $("importFileInput");
  const insertImageFileInput = $("insertImageFileInput");
  const cmdOverlay = $("cmdOverlay"), cmdInput = $("cmdInput"), cmdBody = $("cmdBody");
  const historyOverlay = $("historyOverlay"), historyBody = $("historyBody");
  const dropOverlay = $("dropOverlay");
  const fontSizeDisplay = $("fontSizeDisplay");
  const fontFamilySelect = $("fontFamilySelect");
  const blockStyleSelect = $("blockStyleSelect");

  // ===================== Init =====================
  function init() {
    settings = loadSettings();
    notes = loadNotes();
    if (notes.length === 0) {
      const welcome = makeNote({
        title: "Welcome to TinyNote",
        content: "<h1>Welcome to TinyNote</h1><p>A private space for your thoughts, fast enough to keep up with them.</p><p><strong>Try:</strong></p><ul><li>Press <code>Ctrl/⌘ K</code> for the command palette</li><li>Use the toolbar to format text with bold, italic, headings, and more</li><li>Click the <strong>A</strong> button to change text color with the full color picker</li><li>Export, import — even by dragging a file onto the app</li><li>Works <strong>offline</strong> too!</li></ul><blockquote>Just you and your thoughts.</blockquote>"
      });
      notes = [welcome]; settings.activeId = welcome.id;
      saveNotes(notes); saveSettings(settings);
    }
    applyTheme();
    sidebar.style.width = settings.sidebarWidth + "px";
    sortSelect.value = settings.sortBy;
    bindEvents();
    isMobile = mobileMql.matches; mobileEditorOpen = false;
    renderAll();
  }

  // ===================== Theme =====================
  function applyTheme() {
    document.documentElement.classList.remove("dark", "amoled", "sepia");
    if (settings.theme !== "light") document.documentElement.classList.add(settings.theme);
    saveSettings(settings);
    document.querySelectorAll(".theme-chip").forEach(c => c.classList.toggle("active", c.dataset.theme === settings.theme));
  }

  // ===================== Note operations =====================
  function getActive() { return notes.find(n => n.id === settings.activeId) || null; }
  function setActive(id) { settings.activeId = id; saveSettings(settings); if (isMobile) mobileEditorOpen = true; renderAll(); }
  function updateNote(id, patch) { notes = notes.map(n => n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n); saveNotes(notes); }
  function persistNotes() { saveNotes(notes); }
  function getVisible() {
    const ql = query.trim().toLowerCase();
    let list = notes.filter(n => n.trashed === showTrash);
    if (ql) list = list.filter(n => n.title.toLowerCase().includes(ql) || stripHtml(n.content).toLowerCase().includes(ql));
    return list.slice().sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (settings.sortBy === "name") return a.title.localeCompare(b.title);
      if (settings.sortBy === "created") return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });
  }
  function newNote() { const n = makeNote(); notes = [n, ...notes]; persistNotes(); showTrash = false; setActive(n.id); setTimeout(() => editor.focus(), 60); }
  function duplicateNote(id) {
    const src = notes.find(n => n.id === (id || settings.activeId)); if (!src) return;
    const n = makeNote({ title: src.title + " copy", content: src.content, color: src.color });
    notes = [n, ...notes]; persistNotes(); setActive(n.id);
  }
  function trashNote(id) { notes = notes.map(n => n.id === id ? { ...n, trashed: true, trashedAt: Date.now() } : n); persistNotes(); renderAll(); }
  function restoreNote(id) { notes = notes.map(n => n.id === id ? { ...n, trashed: false } : n); persistNotes(); renderAll(); }
  function deleteForever(id) { notes = notes.filter(n => n.id !== id); persistNotes(); renderAll(); }
  function emptyTrash() { notes = notes.filter(n => !n.trashed); persistNotes(); renderAll(); }
  function togglePin(id) { notes = notes.map(n => n.id === id ? { ...n, pinned: !n.pinned } : n); persistNotes(); renderAll(); }
  function toggleFav(id) { notes = notes.map(n => n.id === id ? { ...n, favorite: !n.favorite } : n); persistNotes(); renderAll(); }
  function setColor(id, color) { notes = notes.map(n => n.id === id ? { ...n, color: color || null } : n); persistNotes(); renderAll(); }

  // ===================== Render =====================
  function renderMobileLayout() {
    if (!isMobile) { sidebar.classList.remove("mobile-hide"); mainPanel.classList.remove("mobile-show"); return; }
    sidebar.classList.toggle("mobile-hide", mobileEditorOpen);
    mainPanel.classList.toggle("mobile-show", mobileEditorOpen);
  }
  function renderAll() {
    root.classList.toggle("zen", zen);
    root.classList.toggle("focus-mode", focusMode);
    renderMobileLayout(); renderRecentSearches(); renderTabs(); renderNotesList(); renderEditorArea(); updateToolbarActiveStates();
  }
  function renderRecentSearches() {
    recentSearchesEl.innerHTML = "";
    if (query || settings.recentSearches.length === 0) return;
    settings.recentSearches.forEach(r => {
      const b = document.createElement("button"); b.className = "recent-chip"; b.textContent = r;
      b.onclick = () => { query = r; searchInput.value = r; toggleClearBtn(); renderAll(); };
      recentSearchesEl.appendChild(b);
    });
  }
  function renderTabs() { tabAll.classList.toggle("tab-active", !showTrash); tabTrash.classList.toggle("tab-active", showTrash); }
  function renderNotesList() {
    const visible = getVisible(); notesListEl.innerHTML = "";
    if (visible.length === 0) {
      const wrap = document.createElement("div"); wrap.className = "empty-list";
      wrap.innerHTML = `<div class="empty-list-icon"><svg viewBox="0 0 24 24" class="icon" style="width:22px;height:22px"><use href="#i-book"/></svg></div><p>${showTrash ? "Trash is empty." : query ? "No matches." : "No notes yet."}</p>`;
      notesListEl.appendChild(wrap);
      if (!showTrash && !query) { const btn = document.createElement("button"); btn.className = "create-first-btn"; btn.textContent = "Create first note"; btn.onclick = newNote; wrap.appendChild(btn); }
      return;
    }
    visible.forEach(n => {
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
        ${n.pinned ? '<svg viewBox="0 0 24 24" class="icon icon-xs pin-mark" style="flex-shrink:0"><use href="#i-pin"/></svg>' : ""}
        ${n.favorite ? '<svg viewBox="0 0 24 24" class="icon icon-xs fav-mark" style="flex-shrink:0;fill:currentColor"><use href="#i-star"/></svg>' : ""}
      </div>
      <div class="note-preview">${escapeHtml(previewText) || "Empty note"}</div>
      <div class="note-meta"><span>${fmt(n.updatedAt)}</span><div class="note-actions"></div></div>`;
      const actions = card.querySelector(".note-actions");
      if (!showTrash) {
        actions.appendChild(iconBtn("i-pin", "Pin", e => { e.stopPropagation(); togglePin(n.id); }));
        actions.appendChild(iconBtn("i-star", "Favorite", e => { e.stopPropagation(); toggleFav(n.id); }));
        actions.appendChild(iconBtn("i-copy", "Duplicate", e => { e.stopPropagation(); duplicateNote(n.id); }));
        actions.appendChild(iconBtn("i-trash", "Delete", e => { e.stopPropagation(); trashNote(n.id); }));
      } else {
        actions.appendChild(iconBtn("i-undo", "Restore", e => { e.stopPropagation(); restoreNote(n.id); }));
        actions.appendChild(iconBtn("i-x", "Delete forever", e => { e.stopPropagation(); deleteForever(n.id); }));
      }
      card.addEventListener("click", () => setActive(n.id));
      card.addEventListener("dragstart", () => { dragId = n.id; });
      card.addEventListener("dragover", e => e.preventDefault());
      card.addEventListener("drop", () => onDrop(n.id));
      notesListEl.appendChild(card);
    });
    if (showTrash && visible.length > 0) {
      const btn = document.createElement("button"); btn.className = "empty-trash-btn"; btn.textContent = "Empty trash";
      btn.onclick = emptyTrash; notesListEl.appendChild(btn);
    }
  }
  function iconBtn(iconId, title, onClick) {
    const b = document.createElement("button"); b.className = "icon-btn-xs"; b.title = title;
    b.innerHTML = `<svg viewBox="0 0 24 24" class="icon"><use href="#${iconId}"/></svg>`; b.onclick = onClick; return b;
  }
  function renderEditorArea() {
    const active = getActive();
    if (!active) { editorView.classList.add("hidden"); emptyState.classList.remove("hidden"); return; }
    emptyState.classList.add("hidden"); editorView.classList.remove("hidden");
    if (document.activeElement !== titleInput) titleInput.value = active.title;
    if (editor.innerHTML !== active.content && document.activeElement !== editor) editor.innerHTML = active.content || "";
    editor.setAttribute("data-empty", editor.textContent?.trim() ? "" : "Start writing…");
    editor.setAttribute("contenteditable", viewOnly ? "false" : "true");
    titleInput.readOnly = viewOnly;
    document.querySelectorAll("#btnUndo, #btnRedo, [data-cmd], [data-block]").forEach(b => { b.disabled = viewOnly; });
    $("btnDeleteAll").toggleAttribute("disabled", viewOnly);
    $("btnPin").classList.toggle("active", !!active.pinned);
    $("btnFav").classList.toggle("fav-active", !!active.favorite);
    $("btnPreview").classList.toggle("active", viewOnly);
    renderStatsOnly();
  }
  function renderStatsOnly() {
    const active = getActive(); if (!active) return;
    const s = countStats(active.content);
    statWords.textContent = `Words: ${s.words}`;
    statChars.textContent = `Characters: ${s.chars}`;
    statRead.textContent = `~${s.readingMin} min read`;
    statSaved.innerHTML = savedAt ? `<span class="save-dot"></span>Saved ${fmt(savedAt)}` : "";
    statEdited.textContent = `Edited ${fmt(active.updatedAt)}`;
  }

  // ===================== Editor commands =====================
  function exec(cmd, val) {
    if (viewOnly) return;
    editor.focus();
    document.execCommand(cmd, false, val ?? null);
    onEditorInput(); updateToolbarActiveStates();
  }

  // Wrap selection with inline style
  function wrapSelectionWithStyle(styleProp, styleValue) {
    if (viewOnly) return;
    editor.focus();
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!editor.contains(range.commonAncestorContainer)) return;
    if (sel.isCollapsed) {
      // Apply to new text typed from cursor position
      const span = document.createElement("span");
      span.style.setProperty(styleProp, styleValue);
      range.insertNode(span);
      const newRange = document.createRange();
      newRange.setStart(span, 0); newRange.collapse(true);
      sel.removeAllRanges(); sel.addRange(newRange);
      return;
    }
    const span = document.createElement("span");
    span.style.setProperty(styleProp, styleValue);
    try { range.surroundContents(span); }
    catch { const frag = range.extractContents(); span.appendChild(frag); range.insertNode(span); }
    const newRange = document.createRange();
    newRange.selectNodeContents(span);
    sel.removeAllRanges(); sel.addRange(newRange);
    onEditorInput();
  }

  // Get font size at cursor
  function getFontSizeAtCursor() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return currentFontSizePx;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    while (node && node !== editor) {
      if (node.nodeType === 1) {
        const fs = window.getComputedStyle(node).fontSize;
        if (fs) return parseFloat(fs);
      }
      node = node.parentElement;
    }
    return parseFloat(window.getComputedStyle(editor).fontSize) || 16;
  }

  function applyFontSize(px) {
    currentFontSizePx = Math.max(8, Math.min(96, px));
    fontSizeDisplay.value = currentFontSizePx;
    wrapSelectionWithStyle("font-size", `${currentFontSizePx}px`);
  }

  // Block format
  const TRACKED_CMDS = ["bold", "italic", "underline", "strikeThrough", "insertUnorderedList", "insertOrderedList"];
  const TRACKED_BLOCKS = ["H1", "H2", "H3", "BLOCKQUOTE", "PRE"];
  const INLINE_TAG_MAP = { bold: ["B", "STRONG"], italic: ["I", "EM"], underline: ["U"], strikeThrough: ["S", "STRIKE", "DEL"] };

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
    return "P";
  }
  function isInlineCmdActive(cmd) {
    const tags = INLINE_TAG_MAP[cmd];
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    let node = sel.getRangeAt(0).startContainer;
    if (node.nodeType === 3) node = node.parentElement;
    while (node && node !== editor) {
      const el = node;
      if (tags && tags.includes(el.tagName)) return true;
      if (cmd === "insertUnorderedList" && el.tagName === "LI" && el.parentElement?.tagName === "UL") return true;
      if (cmd === "insertOrderedList" && el.tagName === "LI" && el.parentElement?.tagName === "OL") return true;
      node = el.parentElement;
    }
    return false;
  }
  function updateToolbarActiveStates() {
    const inEditor = !viewOnly && document.activeElement === editor && isSelectionInEditor();
    document.querySelectorAll("[data-cmd]").forEach(b => {
      b.classList.toggle("active", inEditor && TRACKED_CMDS.includes(b.dataset.cmd || "") && isInlineCmdActive(b.dataset.cmd));
    });
    const blockTag = inEditor ? getBlockTag() : "P";
    document.querySelectorAll("[data-block]").forEach(b => b.classList.toggle("active", b.dataset.block === blockTag));

    // Sync block style select
    if (inEditor) {
      const tag = getBlockTag();
      const validTags = ["P","H1","H2","H3","BLOCKQUOTE","PRE"];
      blockStyleSelect.value = validTags.includes(tag) ? tag : "P";
    }

    // Update font size display
    if (inEditor) {
      const size = getFontSizeAtCursor();
      fontSizeDisplay.value = Math.round(size);
      currentFontSizePx = size;
    }
  }

  // ===================== Editor input =====================
  function onEditorInput() {
    const active = getActive(); if (!active) return;
    const html = editor.innerHTML;
    editor.setAttribute("data-empty", editor.textContent?.trim() ? "" : "Start writing…");
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      const title = active.title === "Untitled" || !active.title ? autoTitle(html) : active.title;
      updateNote(active.id, { content: html, title });
      savedAt = Date.now();
      if (document.activeElement !== titleInput) titleInput.value = notes.find(n => n.id === active.id)?.title || title;
      renderNotesList(); renderStatsOnly();
    }, 250);
    if (historyTimer) clearTimeout(historyTimer);
    historyTimer = setTimeout(() => pushHistory(active.id, html), 4000);
  }

  // ===================== Copy with formatting =====================
  async function copyAllText() {
    const active = getActive(); if (!active) return;
    const htmlContent = active.content;
    const textContent = stripHtml(active.content);
    const flashSuccess = () => {
      const btn = $("btnCopyAll");
      btn.classList.add("copy-success");
      setTimeout(() => btn.classList.remove("copy-success"), 1200);
    };
    try {
      if (typeof ClipboardItem !== "undefined") {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([htmlContent], { type: "text/html" }),
            "text/plain": new Blob([textContent], { type: "text/plain" })
          })
        ]);
      } else {
        await navigator.clipboard.writeText(textContent);
      }
      flashSuccess();
    } catch {
      // Fallback: textarea copy
      const ta = document.createElement("textarea");
      ta.value = textContent;
      Object.assign(ta.style, { position: "fixed", opacity: "0", top: "0", left: "0" });
      document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); flashSuccess(); } catch {}
      ta.remove();
    }
  }

  // ===================== Export =====================
  function exportNote(n, kind) {
    const base = (n.title || "note").replace(/[^\w-]+/g, "_");
    if (kind === "txt") download(`${base}.txt`, stripHtml(n.content));
    else if (kind === "md") download(`${base}.md`, `# ${n.title}\n\n${htmlToMarkdown(n.content)}`);
    else download(`${base}.json`, JSON.stringify(n, null, 2), "application/json");
  }
  function exportAll() {
    download(`tinynote-backup-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify({ version: 1, exportedAt: Date.now(), notes }, null, 2), "application/json");
  }
  async function importFile(file) {
    const text = await file.text();
    try {
      if (file.name.endsWith(".json")) {
        const data = JSON.parse(text);
        const incoming = Array.isArray(data) ? data : data.notes || [data];
        const clean = incoming.filter(x => !!x && typeof x === "object").map(x => makeNote({ ...x, id: makeNote().id }));
        notes = [...clean, ...notes]; persistNotes(); renderAll(); return;
      }
      const n = makeNote({
        title: file.name.replace(/\.[^.]+$/, ""),
        content: file.name.endsWith(".md")
          ? `<pre>${text.replace(/</g, "&lt;")}</pre>`
          : `<p>${text.replace(/</g, "&lt;").replace(/\n/g, "</p><p>")}</p>`
      });
      notes = [n, ...notes]; persistNotes(); setActive(n.id);
    } catch (e) { alert("Import failed: " + (e instanceof Error ? e.message : String(e))); }
  }
  function onDrop(targetId) {
    if (!dragId || dragId === targetId) return;
    const arr = [...notes];
    const from = arr.findIndex(n => n.id === dragId), to = arr.findIndex(n => n.id === targetId);
    if (from >= 0 && to >= 0) { const [m] = arr.splice(from, 1); arr.splice(to, 0, m); notes = arr; persistNotes(); renderAll(); }
    dragId = null;
  }

  // ===================== Fullscreen / modes =====================
  function toggleFullscreen() {
    if (!document.fullscreenElement) document.documentElement.requestFullscreen?.();
    else document.exitFullscreen?.();
  }

  // ===================== Floating menus =====================
  const floatingMenus = [];
  let floatingScrim;
  function isMobileVP() { return window.matchMedia("(max-width: 720px)").matches; }
  function positionFloating(trigger, panel) {
    const r = trigger.getBoundingClientRect();
    const pw = panel.getBoundingClientRect().width || 240;
    const ph = panel.getBoundingClientRect().height || 0;
    let left = r.right - pw;
    left = Math.max(8, Math.min(left, window.innerWidth - pw - 8));
    let top = r.bottom + 6;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, r.top - ph - 6);
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }
  function closeAllFloating() { floatingMenus.forEach(({ panel }) => panel.classList.remove("open")); floatingScrim.classList.remove("show"); }
  function openFloatingMenu(trigger, panel) {
    closeAllFloating();
    const mobile = isMobileVP();
    panel.classList.toggle("sheet-mode", mobile);
    if (mobile) floatingScrim.classList.add("show");
    else positionFloating(trigger, panel);
    requestAnimationFrame(() => panel.classList.add("open"));
  }
  function registerFloatingMenu(triggerId, panelId) {
    const trigger = $(triggerId), panel = $(panelId);
    document.body.appendChild(panel);
    floatingMenus.push({ trigger, panel });
    trigger.addEventListener("mousedown", e => e.preventDefault());
    panel.addEventListener("mousedown", e => e.preventDefault());
    trigger.addEventListener("click", e => {
      e.stopPropagation();
      panel.classList.contains("open") ? closeAllFloating() : openFloatingMenu(trigger, panel);
    });
    panel.addEventListener("click", e => e.stopPropagation());
    return panel;
  }

  // ===================== Premium Color Picker =====================
  // Shared HSV picker state
  const cpState = {
    tc: { h: 0, s: 100, v: 0, hex: "#000000", gradDirty: true },
    hl: { h: 60, s: 100, v: 100, hex: "#FFFF00", gradDirty: true }
  };

  function hexToHSV(hex) {
    if (hex === "inherit" || hex === "transparent") return { h: 0, s: 0, v: 100 };
    hex = hex.replace("#", "");
    if (hex.length === 3) hex = hex.split("").map(c => c + c).join("");
    const r = parseInt(hex.slice(0, 2), 16) / 255;
    const g = parseInt(hex.slice(2, 4), 16) / 255;
    const b = parseInt(hex.slice(4, 6), 16) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d !== 0) {
      if (max === r) h = ((g - b) / d + 6) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h = h / 6 * 360;
    }
    return { h, s: max === 0 ? 0 : d / max * 100, v: max * 100 };
  }
  function hsvToHex(h, s, v) {
    s /= 100; v /= 100;
    const f = n => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
    const to255 = x => Math.round(x * 255).toString(16).padStart(2, "0");
    return `#${to255(f(5))}${to255(f(3))}${to255(f(1))}`;
  }

  function drawGradient(canvas, h) {
    const ctx = canvas.getContext("2d");
    const w = canvas.width, ht = canvas.height;
    // White to hue horizontal gradient
    const hGrad = ctx.createLinearGradient(0, 0, w, 0);
    hGrad.addColorStop(0, "#fff");
    hGrad.addColorStop(1, `hsl(${h},100%,50%)`);
    ctx.fillStyle = hGrad; ctx.fillRect(0, 0, w, ht);
    // Black transparent gradient vertical
    const vGrad = ctx.createLinearGradient(0, 0, 0, ht);
    vGrad.addColorStop(0, "rgba(0,0,0,0)");
    vGrad.addColorStop(1, "#000");
    ctx.fillStyle = vGrad; ctx.fillRect(0, 0, w, ht);
  }
  function drawHue(canvas) {
    const ctx = canvas.getContext("2d");
    const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
    for (let i = 0; i <= 360; i += 30) grad.addColorStop(i / 360, `hsl(${i},100%,50%)`);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Rounded ends
    ctx.clearRect(0, 0, 0, canvas.height);
  }

  function initColorPicker(prefix, hexInputId, gradCanvasId, hueCanvasId, previewId, applyBtnId, onApply) {
    const hexIn = $(hexInputId);
    const gradCanvas = $(gradCanvasId);
    const hueCanvas = $(hueCanvasId);
    const preview = $(previewId);
    const state = cpState[prefix];
    let draggingGrad = false, draggingHue = false;
    let gradThumb = null, hueThumb = null;

    function syncAll() {
      state.hex = hsvToHex(state.h, state.s, state.v);
      hexIn.value = state.hex;
      preview.style.background = state.hex;
      drawGradient(gradCanvas, state.h);
      drawHue(hueCanvas);
      // Draw thumbs
      drawGradThumb();
      drawHueThumb();
    }

    function drawGradThumb() {
      // Remove old thumb
      if (gradThumb) { gradThumb.remove(); gradThumb = null; }
      const wr = gradCanvas.parentElement;
      if (!wr) return;
      const x = (state.s / 100) * gradCanvas.offsetWidth;
      const y = (1 - state.v / 100) * gradCanvas.offsetHeight;
      gradThumb = document.createElement("div");
      Object.assign(gradThumb.style, {
        position: "absolute", width: "12px", height: "12px", borderRadius: "50%",
        border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.4)",
        background: state.hex, pointerEvents: "none", zIndex: "2",
        left: `${x - 6}px`, top: `${y - 6}px`,
        transform: "none"
      });
      wr.style.position = "relative";
      wr.appendChild(gradThumb);
    }

    function drawHueThumb() {
      if (hueThumb) { hueThumb.remove(); hueThumb = null; }
      const wr = hueCanvas.parentElement;
      if (!wr) return;
      const x = (state.h / 360) * hueCanvas.offsetWidth;
      hueThumb = document.createElement("div");
      Object.assign(hueThumb.style, {
        position: "absolute", width: "14px", height: "22px", borderRadius: "3px",
        border: "2px solid #fff", boxShadow: "0 0 0 1px rgba(0,0,0,.4)",
        background: `hsl(${state.h},100%,50%)`, pointerEvents: "none", zIndex: "2",
        left: `${x - 7}px`, top: "-3px"
      });
      wr.style.position = "relative";
      wr.appendChild(hueThumb);
    }

    function gradPick(e) {
      const rect = gradCanvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      const y = Math.max(0, Math.min(e.clientY - rect.top, rect.height));
      state.s = (x / rect.width) * 100;
      state.v = (1 - y / rect.height) * 100;
      syncAll();
    }
    function huePick(e) {
      const rect = hueCanvas.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      state.h = (x / rect.width) * 360;
      syncAll();
    }

    gradCanvas.addEventListener("mousedown", e => { draggingGrad = true; gradPick(e); e.preventDefault(); });
    hueCanvas.addEventListener("mousedown", e => { draggingHue = true; huePick(e); e.preventDefault(); });
    document.addEventListener("mousemove", e => { if (draggingGrad) gradPick(e); if (draggingHue) huePick(e); });
    document.addEventListener("mouseup", () => { draggingGrad = false; draggingHue = false; });

    // Touch support
    const toMouseEvent = te => ({ clientX: te.touches[0].clientX, clientY: te.touches[0].clientY });
    gradCanvas.addEventListener("touchstart", e => { draggingGrad = true; gradPick(toMouseEvent(e)); e.preventDefault(); }, { passive: false });
    hueCanvas.addEventListener("touchstart", e => { draggingHue = true; huePick(toMouseEvent(e)); e.preventDefault(); }, { passive: false });
    document.addEventListener("touchmove", e => {
      if (draggingGrad) gradPick(toMouseEvent(e));
      if (draggingHue) huePick(toMouseEvent(e));
    });
    document.addEventListener("touchend", () => { draggingGrad = false; draggingHue = false; });

    hexIn.addEventListener("input", () => {
      let val = hexIn.value.trim();
      if (!val.startsWith("#")) val = "#" + val;
      if (/^#[0-9a-fA-F]{6}$/.test(val)) {
        const hsv = hexToHSV(val);
        state.h = hsv.h; state.s = hsv.s; state.v = hsv.v;
        syncAll();
      }
    });

    // Quick swatches
    const panel = $(applyBtnId).closest(".color-picker-panel");
    panel.querySelectorAll(".cp-swatch").forEach(sw => {
      sw.addEventListener("click", e => {
        e.stopPropagation();
        const hex = sw.dataset.hex;
        if (hex === "transparent" || hex === "inherit") {
          onApply(hex); closeAllFloating(); return;
        }
        const hsv = hexToHSV(hex);
        state.h = hsv.h; state.s = hsv.s; state.v = hsv.v;
        syncAll();
      });
    });

    $(applyBtnId).addEventListener("click", e => {
      e.stopPropagation();
      onApply(state.hex);
      closeAllFloating();
    });

    // Redraw on open
    return () => { syncAll(); };
  }

  // ===================== Command palette =====================
  function actionsList() {
    const active = getActive();
    return [
      { label: "New note", hint: "⌘N", run: () => { newNote(); closeCmd(); } },
      { label: "Duplicate active", hint: "⌘D", run: () => { duplicateNote(); closeCmd(); } },
      { label: "Export as Markdown", hint: "⌘S", run: () => { if (active) exportNote(active, "md"); closeCmd(); } },
      { label: "Export all (backup)", run: () => { exportAll(); closeCmd(); } },
      { label: "Toggle Zen mode", run: () => { zen = !zen; renderAll(); closeCmd(); } },
      { label: "Toggle Focus mode", run: () => { focusMode = !focusMode; renderAll(); closeCmd(); } },
      { label: "Theme: Light", run: () => { settings.theme = "light"; applyTheme(); closeCmd(); } },
      { label: "Theme: Dark", run: () => { settings.theme = "dark"; applyTheme(); closeCmd(); } },
      { label: "Theme: AMOLED", run: () => { settings.theme = "amoled"; applyTheme(); closeCmd(); } },
      { label: "Theme: Sepia", run: () => { settings.theme = "sepia"; applyTheme(); closeCmd(); } },
    ];
  }
  function openCmd() { cmdOverlay.classList.remove("hidden"); cmdInput.value = ""; cmdInput.focus(); renderCmd(""); }
  function closeCmd() { cmdOverlay.classList.add("hidden"); }
  function renderCmd(q) {
    const ql = q.toLowerCase();
    const actions = actionsList().filter(a => a.label.toLowerCase().includes(ql));
    const noteList = q ? notes.filter(n => n.title.toLowerCase().includes(ql) || stripHtml(n.content).toLowerCase().includes(ql)).slice(0, 8) : notes.slice(0, 6);
    cmdBody.innerHTML = "";
    if (actions.length > 0) {
      const lbl = document.createElement("div"); lbl.className = "cmd-section-label"; lbl.textContent = "Actions"; cmdBody.appendChild(lbl);
      actions.forEach(a => {
        const row = document.createElement("button"); row.className = "cmd-row";
        row.innerHTML = `<span style="flex:1">${escapeHtml(a.label)}</span>${a.hint ? `<kbd style="font-size:10px;color:var(--muted-foreground)">${a.hint}</kbd>` : ""}`;
        row.onclick = a.run; cmdBody.appendChild(row);
      });
    }
    if (noteList.length > 0) {
      const lbl = document.createElement("div"); lbl.className = "cmd-section-label"; lbl.textContent = "Notes"; cmdBody.appendChild(lbl);
      noteList.forEach(n => {
        const row = document.createElement("button"); row.className = "cmd-row";
        row.innerHTML = `<svg viewBox="0 0 24 24" class="icon icon-sm muted"><use href="#i-book"/></svg><span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(n.title || "Untitled")}</span><span style="font-size:10px;color:var(--muted-foreground)">${fmt(n.updatedAt)}</span>`;
        row.onclick = () => { setActive(n.id); closeCmd(); };
        cmdBody.appendChild(row);
      });
    }
    if (!actions.length && !noteList.length) {
      const div = document.createElement("div"); div.className = "cmd-empty"; div.textContent = "No matches"; cmdBody.appendChild(div);
    }
  }

  // ===================== History =====================
  function openHistory() {
    const active = getActive(); if (!active) return;
    const versions = loadHistory(active.id).slice().reverse();
    historyBody.innerHTML = "";
    if (!versions.length) {
      const div = document.createElement("div"); div.className = "history-empty";
      div.textContent = "No versions yet. Keep writing to build a history here.";
      historyBody.appendChild(div);
    }
    versions.forEach(v => {
      const item = document.createElement("div"); item.className = "history-item";
      item.innerHTML = `<div class="history-item-top"><span style="font-weight:500">${new Date(v.t).toLocaleString()}</span><button class="history-restore">Restore</button></div><div class="history-snippet">${escapeHtml(stripHtml(v.c).slice(0, 200)) || "Empty"}</div>`;
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

  // ===================== Bind events =====================
  function toggleClearBtn() { btnClearSearch.classList.toggle("hidden", !query); }

  let refreshTextColorPicker, refreshHighlightPicker;

  function bindEvents() {
    // Prevent toolbar buttons from stealing focus
    document.querySelectorAll(".toolbar button, .toolbar select").forEach(b => {
      if (b.tagName !== "SELECT") b.addEventListener("mousedown", e => e.preventDefault());
    });

    // New note
    $("btnNewNoteTop").onclick = newNote;
    $("btnEmptyNew").onclick = newNote;

    // Search
    searchInput.addEventListener("input", e => { query = e.target.value; toggleClearBtn(); renderAll(); });
    searchInput.addEventListener("keydown", e => {
      if (e.key === "Enter" && query.trim()) {
        settings.recentSearches = [query, ...settings.recentSearches.filter(x => x !== query)].slice(0, 6);
        saveSettings(settings); renderRecentSearches();
      }
    });
    btnClearSearch.onclick = () => { query = ""; searchInput.value = ""; toggleClearBtn(); renderAll(); };

    // Tabs / sort
    tabAll.onclick = () => { showTrash = false; renderAll(); };
    tabTrash.onclick = () => { showTrash = true; renderAll(); };
    sortSelect.onchange = e => { settings.sortBy = e.target.value; saveSettings(settings); renderAll(); };

    // Themes
    document.querySelectorAll(".theme-chip").forEach(c => { c.onclick = () => { settings.theme = c.dataset.theme || "light"; applyTheme(); }; });
    $("btnCmdPalette2").onclick = openCmd;

    // Title
    titleInput.addEventListener("input", () => { const a = getActive(); if (!a) return; updateNote(a.id, { title: titleInput.value }); renderNotesList(); });

    // Undo/Redo
    $("btnUndo").onclick = () => exec("undo");
    $("btnRedo").onclick = () => exec("redo");

    // Inline format buttons
    document.querySelectorAll("[data-cmd]").forEach(b => { b.onclick = () => exec(b.dataset.cmd || ""); });

    // Inline code button
    $("btnInlineCode").onclick = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !editor.contains(sel.anchorNode)) return;
      const range = sel.getRangeAt(0);
      const code = document.createElement("code");
      try { range.surroundContents(code); } catch { const f = range.extractContents(); code.appendChild(f); range.insertNode(code); }
      onEditorInput();
    };

    // Direct link button
    $("btnInsertLinkDirect").onclick = () => insertLink();

    // Font family select
    fontFamilySelect.addEventListener("change", () => {
      wrapSelectionWithStyle("font-family", fontFamilySelect.value);
    });

    // Block style select
    blockStyleSelect.addEventListener("change", () => {
      const tag = blockStyleSelect.value;
      if (tag === "PRE") exec("formatBlock", "PRE");
      else exec("formatBlock", tag);
    });

    // Font size controls
    $("btnFontSizeDec").onclick = () => { applyFontSize(Math.round(currentFontSizePx) - 1); };
    $("btnFontSizeInc").onclick = () => { applyFontSize(Math.round(currentFontSizePx) + 1); };
    fontSizeDisplay.addEventListener("change", () => { const v = parseInt(fontSizeDisplay.value); if (!isNaN(v)) applyFontSize(v); });
    fontSizeDisplay.addEventListener("keydown", e => { if (e.key === "Enter") { const v = parseInt(fontSizeDisplay.value); if (!isNaN(v)) applyFontSize(v); editor.focus(); } });

    // Floating scrim
    floatingScrim = document.createElement("div"); floatingScrim.className = "floating-scrim";
    document.body.appendChild(floatingScrim);
    floatingScrim.addEventListener("click", closeAllFloating);

    // Label color popover
    const colorPopover = registerFloatingMenu("btnColor", "colorPopover");
    colorPopover.querySelectorAll(".swatch").forEach(sw => {
      sw.onclick = () => { const a = getActive(); if (a) setColor(a.id, sw.dataset.color || ""); closeAllFloating(); };
    });

    // Text color picker
    const textColorPopoverEl = $("textColorPopover");
    document.body.appendChild(textColorPopoverEl);
    floatingMenus.push({ trigger: $("btnTextColor"), panel: textColorPopoverEl });
    $("btnTextColor").addEventListener("mousedown", e => e.preventDefault());
    $("btnTextColor").addEventListener("click", e => {
      e.stopPropagation();
      if (textColorPopoverEl.classList.contains("open")) { closeAllFloating(); return; }
      closeAllFloating();
      const mobile = isMobileVP();
      textColorPopoverEl.classList.toggle("sheet-mode", mobile);
      if (mobile) floatingScrim.classList.add("show");
      else positionFloating($("btnTextColor"), textColorPopoverEl);
      requestAnimationFrame(() => {
        textColorPopoverEl.classList.add("open");
        if (refreshTextColorPicker) refreshTextColorPicker();
      });
    });
    textColorPopoverEl.addEventListener("mousedown", e => e.preventDefault());
    textColorPopoverEl.addEventListener("click", e => e.stopPropagation());

    // Highlight color picker
    const hlPopoverEl = $("highlightColorPopover");
    document.body.appendChild(hlPopoverEl);
    floatingMenus.push({ trigger: $("btnHighlightColor"), panel: hlPopoverEl });
    $("btnHighlightColor").addEventListener("mousedown", e => e.preventDefault());
    $("btnHighlightColor").addEventListener("click", e => {
      e.stopPropagation();
      if (hlPopoverEl.classList.contains("open")) { closeAllFloating(); return; }
      closeAllFloating();
      const mobile = isMobileVP();
      hlPopoverEl.classList.toggle("sheet-mode", mobile);
      if (mobile) floatingScrim.classList.add("show");
      else positionFloating($("btnHighlightColor"), hlPopoverEl);
      requestAnimationFrame(() => {
        hlPopoverEl.classList.add("open");
        if (refreshHighlightPicker) refreshHighlightPicker();
      });
    });
    hlPopoverEl.addEventListener("mousedown", e => e.preventDefault());
    hlPopoverEl.addEventListener("click", e => e.stopPropagation());

    // Init color pickers
    refreshTextColorPicker = initColorPicker("tc", "tcHexInput", "tcGradient", "tcHue", "tcPreview", "tcApplyBtn", hex => {
      currentTextColor = hex === "inherit" ? "inherit" : hex;
      $("textColorUnderline").style.background = hex === "inherit" ? "currentColor" : hex;
      wrapSelectionWithStyle("color", currentTextColor);
    });
    refreshHighlightPicker = initColorPicker("hl", "hlHexInput", "hlGradient", "hlHue", "hlPreview", "hlApplyBtn", hex => {
      currentHighlightColor = hex;
      $("highlightColorUnderline").style.background = hex === "transparent" ? "transparent" : hex;
      if (hex === "transparent") wrapSelectionWithStyle("background-color", "transparent");
      else wrapSelectionWithStyle("background-color", hex);
    });

    // More menu
    const moreMenu = registerFloatingMenu("btnMore", "moreMenu");
    const insertMenu = registerFloatingMenu("btnInsert", "insertMenu");

    // Insert items
    $("mInsertLink").onclick = () => { closeAllFloating(); insertLink(); };
    $("mInsertImage").onclick = () => {
      closeAllFloating();
      const url = prompt("Image URL (https://…)");
      if (!url) return;
      editor.focus(); document.execCommand("insertImage", false, url); onEditorInput();
    };
    $("mInsertImageFile").onclick = () => { closeAllFloating(); insertImageFileInput.click(); };
    $("mInsertChecklist").onclick = () => {
      closeAllFloating(); if (viewOnly) return;
      editor.focus();
      document.execCommand("insertHTML", false, '<ul class="checklist"><li><label><input type="checkbox"> Untitled task</label></li></ul><p><br></p>');
      onEditorInput();
    };
    $("mInsertTable").onclick = () => {
      closeAllFloating(); if (viewOnly) return;
      editor.focus();
      const html = `<table><thead><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr></thead><tbody><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr><tr><td>Cell</td><td>Cell</td><td>Cell</td></tr></tbody></table><p><br></p>`;
      document.execCommand("insertHTML", false, html); onEditorInput();
    };
    $("mInsertDate").onclick = () => {
      closeAllFloating(); if (viewOnly) return;
      editor.focus();
      const d = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
      document.execCommand("insertText", false, d); onEditorInput();
    };

    function insertLink() {
      const url = prompt("Link URL (https://…)");
      if (!url) return;
      editor.focus();
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && editor.contains(sel.anchorNode)) document.execCommand("createLink", false, url);
      else document.execCommand("insertHTML", false, `<a href="${escapeHtml(url)}" target="_blank" rel="noopener">${escapeHtml(url)}</a>`);
      onEditorInput();
    }

    // Pin / Fav / Preview / History
    $("btnPin").onclick = () => { const a = getActive(); if (a) togglePin(a.id); };
    $("btnFav").onclick = () => { const a = getActive(); if (a) toggleFav(a.id); };
    $("btnPreview").onclick = () => { viewOnly = !viewOnly; renderEditorArea(); updateToolbarActiveStates(); };
    $("btnHistory").onclick = openHistory;
    $("btnCloseHistory").onclick = () => historyOverlay.classList.add("hidden");
    historyOverlay.onclick = e => { if (e.target === historyOverlay) historyOverlay.classList.add("hidden"); };

    // More menu items
    $("mExportTxt").onclick = () => { const a = getActive(); if (a) exportNote(a, "txt"); closeAllFloating(); };
    $("mExportMd").onclick = () => { const a = getActive(); if (a) exportNote(a, "md"); closeAllFloating(); };
    $("mExportJson").onclick = () => { const a = getActive(); if (a) exportNote(a, "json"); closeAllFloating(); };
    $("mExportPdf").onclick = () => {
      closeAllFloating();
      const active = getActive(); if (!active) return;
      const prev = document.title;
      document.title = (active.title || "Untitled") + " — TinyNote";
      document.body.classList.add("printing-note");
      window.print();
      setTimeout(() => { document.body.classList.remove("printing-note"); document.title = prev; }, 400);
    };
    $("mExportAll").onclick = () => { exportAll(); closeAllFloating(); };
    $("mImport").onclick = () => { importFileInput.click(); closeAllFloating(); };
    $("mZen").onclick = () => { zen = !zen; renderAll(); closeAllFloating(); };
    $("mFocus").onclick = () => { focusMode = !focusMode; renderAll(); closeAllFloating(); };
    $("mFullscreen").onclick = () => { toggleFullscreen(); closeAllFloating(); };

    // Status bar actions
    $("btnCopyAll").onclick = copyAllText;
    $("btnDownloadNote").onclick = () => { const a = getActive(); if (a) exportNote(a, "txt"); };
    $("btnDeleteAll").onclick = () => {
      const active = getActive(); if (!active || viewOnly) return;
      if (!active.content.trim() && !editor.textContent?.trim()) return;
      if (!confirm("Delete all text in this note? This can't be undone.")) return;
      editor.innerHTML = ""; updateNote(active.id, { content: "" });
      editor.setAttribute("data-empty", "Start writing…");
      renderNotesList(); renderStatsOnly(); editor.focus();
    };

    // Image file input
    insertImageFileInput.addEventListener("change", e => {
      const file = e.target.files?.[0]; if (!file) return;
      const reader = new FileReader();
      reader.onload = ev => {
        const url = ev.target?.result;
        if (!url) return;
        editor.focus();
        document.execCommand("insertImage", false, url);
        onEditorInput();
      };
      reader.readAsDataURL(file);
      e.target.value = "";
    });

    // Import file
    importFileInput.addEventListener("change", e => {
      const files = e.target.files;
      if (files) Array.from(files).forEach(f => importFile(f));
      e.target.value = "";
    });

    // Editor events
    editor.addEventListener("input", onEditorInput);
    editor.addEventListener("keyup", updateToolbarActiveStates);
    editor.addEventListener("mouseup", updateToolbarActiveStates);
    editor.addEventListener("focus", updateToolbarActiveStates);
    editor.addEventListener("blur", updateToolbarActiveStates);
    document.addEventListener("selectionchange", updateToolbarActiveStates);

    // *** FIX: Ctrl+A in editor only selects editor content ***
    editor.addEventListener("keydown", e => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "a") {
        e.preventDefault();
        const range = document.createRange();
        range.selectNodeContents(editor);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        return;
      }
    });

    // Global keyboard shortcuts
    document.addEventListener("keydown", e => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); cmdOverlay.classList.contains("hidden") ? openCmd() : closeCmd(); return; }
      if (mod && e.key.toLowerCase() === "n") { e.preventDefault(); newNote(); return; }
      if (mod && e.key.toLowerCase() === "f") { e.preventDefault(); searchInput.focus(); return; }
      if (mod && e.key.toLowerCase() === "d") { e.preventDefault(); duplicateNote(); return; }
      if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); const a = getActive(); if (a) exportNote(a, "md"); return; }
      if (e.key === "Escape") { closeCmd(); historyOverlay.classList.add("hidden"); closeAllFloating(); }
    });

    document.addEventListener("click", closeAllFloating);
    window.addEventListener("resize", closeAllFloating);

    // Command palette
    cmdInput.addEventListener("input", e => renderCmd(e.target.value));
    cmdOverlay.addEventListener("click", e => { if (e.target === cmdOverlay) closeCmd(); });

    // Fullscreen label
    document.addEventListener("fullscreenchange", () => {
      $("fsLabel").textContent = document.fullscreenElement ? "Exit fullscreen" : "Fullscreen";
    });

    // Mobile back
    $("btnMobileBack").onclick = () => { mobileEditorOpen = false; renderMobileLayout(); };
    mobileMql.addEventListener("change", e => { isMobile = e.matches; renderMobileLayout(); });

    // Sidebar resize
    $("resizeHandle").addEventListener("mousedown", () => { resizing = true; });
    window.addEventListener("mousemove", e => {
      if (!resizing) return;
      const w = Math.max(220, Math.min(480, e.clientX));
      settings.sidebarWidth = w; sidebar.style.width = w + "px";
    });
    window.addEventListener("mouseup", () => { if (resizing) { resizing = false; saveSettings(settings); } });

    // Drag-and-drop import
    const hasFiles = e => !!e.dataTransfer && Array.from(e.dataTransfer.types).includes("Files");
    window.addEventListener("dragenter", e => { if (!hasFiles(e)) return; e.preventDefault(); dragDepth++; dropOverlay.classList.remove("hidden"); });
    window.addEventListener("dragover", e => { if (!hasFiles(e)) return; e.preventDefault(); });
    window.addEventListener("dragleave", e => { if (!hasFiles(e)) return; dragDepth = Math.max(0, dragDepth - 1); if (dragDepth === 0) dropOverlay.classList.add("hidden"); });
    window.addEventListener("drop", e => {
      if (!hasFiles(e)) return; e.preventDefault(); dragDepth = 0; dropOverlay.classList.add("hidden");
      if (e.dataTransfer) Array.from(e.dataTransfer.files).forEach(f => importFile(f));
    });
  }

  init();
})();
