/* TinyNote — vanilla JS app */
(() => {
  'use strict';

  // ------------ Storage ------------
  const NOTES_KEY = 'tinynote.notes.v1';
  const SETTINGS_KEY = 'tinynote.settings.v1';

  const uid = () => 'n_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);

  const load = (k, d) => {
    try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : d; } catch { return d; }
  };
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };

  let notes = load(NOTES_KEY, []);
  let settings = Object.assign({
    theme: 'light',
    sortBy: 'updated',
    activeId: null,
    filter: 'all',
  }, load(SETTINGS_KEY, {}));

  const persistNotes = () => save(NOTES_KEY, notes);
  const persistSettings = () => save(SETTINGS_KEY, settings);

  const stripHtml = (html) => { const d = document.createElement('div'); d.innerHTML = html; return d.textContent || ''; };
  const autoTitle = (html) => {
    const t = stripHtml(html).trim();
    if (!t) return 'Untitled';
    return t.split('\n')[0].slice(0, 80) || 'Untitled';
  };
  const stats = (html) => {
    const t = stripHtml(html).trim();
    const words = t ? t.split(/\s+/).filter(Boolean).length : 0;
    return { words, chars: t.length, read: Math.max(1, Math.round(words / 200)) };
  };

  const makeNote = () => ({
    id: uid(), title: 'Untitled', content: '',
    createdAt: Date.now(), updatedAt: Date.now(),
    pinned: false, favorite: false, trashed: false,
  });

  // ------------ Elements ------------
  const $ = (id) => document.getElementById(id);
  const editor = $('editor');
  const titleInput = $('titleInput');
  const notesList = $('notesList');
  const searchInput = $('searchInput');
  const saveState = $('saveState');
  const statsEl = $('stats');
  const sortSel = $('sortBy');

  // ------------ Theme ------------
  const applyTheme = (t) => {
    document.body.classList.remove('light', 'dark', 'amoled', 'sepia');
    document.body.classList.add(t);
    settings.theme = t; persistSettings();
    document.querySelectorAll('.theme-dot').forEach(d => d.classList.toggle('active', d.dataset.theme === t));
  };
  document.querySelectorAll('.theme-dot').forEach(d => d.addEventListener('click', () => applyTheme(d.dataset.theme)));

  // ------------ Notes list ------------
  const renderList = () => {
    const q = searchInput.value.trim().toLowerCase();
    const filter = settings.filter;
    let list = notes.slice();
    if (filter === 'trash') list = list.filter(n => n.trashed);
    else {
      list = list.filter(n => !n.trashed);
      if (filter === 'pinned') list = list.filter(n => n.pinned);
      if (filter === 'favorite') list = list.filter(n => n.favorite);
    }
    if (q) list = list.filter(n => n.title.toLowerCase().includes(q) || stripHtml(n.content).toLowerCase().includes(q));

    const sortBy = settings.sortBy;
    list.sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      if (sortBy === 'name') return a.title.localeCompare(b.title);
      if (sortBy === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });

    notesList.innerHTML = '';
    if (!list.length) {
      notesList.innerHTML = '<div style="text-align:center;color:var(--muted);font-size:13px;padding:24px 8px;">No notes yet.</div>';
      return;
    }
    list.forEach(n => {
      const el = document.createElement('div');
      el.className = 'note-item' + (n.id === settings.activeId ? ' active' : '');
      const preview = stripHtml(n.content).slice(0, 60) || 'Empty note';
      el.innerHTML = `
        <div class="note-title">
          ${n.pinned ? '📌' : ''}${n.favorite ? '★' : ''}
          <span>${escapeHtml(n.title)}</span>
        </div>
        <div class="note-preview">${escapeHtml(preview)}</div>
        <div class="note-meta">
          <span>${new Date(n.updatedAt).toLocaleDateString()}</span>
          <span>${stats(n.content).words}w</span>
        </div>`;
      el.addEventListener('click', () => selectNote(n.id));
      notesList.appendChild(el);
    });
  };

  const escapeHtml = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

  // ------------ Active note ------------
  const activeNote = () => notes.find(n => n.id === settings.activeId);

  const selectNote = (id) => {
    settings.activeId = id; persistSettings();
    const n = activeNote();
    if (n) {
      titleInput.value = n.title === 'Untitled' ? '' : n.title;
      editor.innerHTML = n.content;
      updateStats();
      updatePinFav();
    }
    renderList();
    closeSidebar();
  };

  const newNote = () => {
    const n = makeNote();
    notes.unshift(n); persistNotes();
    selectNote(n.id);
    setTimeout(() => titleInput.focus(), 100);
  };

  // ------------ Auto save ------------
  let saveTimer = null;
  const scheduleSave = () => {
    const n = activeNote(); if (!n) return;
    saveState.textContent = '● Saving…'; saveState.className = 'saving';
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      n.content = editor.innerHTML;
      n.title = titleInput.value.trim() || autoTitle(n.content);
      n.updatedAt = Date.now();
      persistNotes();
      saveState.textContent = '● Saved'; saveState.className = 'saved';
      renderList();
      updateStats();
    }, 400);
  };

  const updateStats = () => {
    const s = stats(editor.innerHTML);
    statsEl.textContent = `${s.words} words · ${s.chars} chars · ${s.read} min read`;
  };

  const updatePinFav = () => {
    const n = activeNote(); if (!n) return;
    $('pinBtn').classList.toggle('active', n.pinned);
    $('favBtn').classList.toggle('active', n.favorite);
  };

  editor.addEventListener('input', scheduleSave);
  titleInput.addEventListener('input', scheduleSave);

  // Keep toolbar state
  const updateToolbarState = () => {
    document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
      const c = btn.dataset.cmd;
      try { btn.classList.toggle('active', document.queryCommandState(c)); } catch {}
    });
  };
  editor.addEventListener('keyup', updateToolbarState);
  editor.addEventListener('mouseup', updateToolbarState);

  // ------------ Toolbar ------------
  const exec = (cmd, val = null) => {
    editor.focus();
    document.execCommand(cmd, false, val);
    scheduleSave();
    updateToolbarState();
  };

  document.querySelectorAll('.tb-btn[data-cmd]').forEach(btn => {
    btn.addEventListener('mousedown', e => e.preventDefault());
    btn.addEventListener('click', () => exec(btn.dataset.cmd));
  });

  $('blockStyle').addEventListener('change', e => {
    exec('formatBlock', e.target.value);
    e.target.value = 'p';
  });
  $('fontFamily').addEventListener('change', e => {
    if (e.target.value) exec('fontName', e.target.value);
  });
  $('fontSize').addEventListener('change', e => {
    if (e.target.value) exec('fontSize', e.target.value);
    e.target.value = '';
  });
  $('foreColor').addEventListener('input', e => exec('foreColor', e.target.value));
  $('hiliteColor').addEventListener('input', e => exec('hiliteColor', e.target.value));

  $('insertLink').addEventListener('click', () => {
    const url = prompt('Enter URL:', 'https://');
    if (url) exec('createLink', url);
  });
  $('insertImage').addEventListener('click', () => {
    const url = prompt('Image URL:', 'https://');
    if (url) exec('insertImage', url);
  });
  $('insertTable').addEventListener('click', () => {
    const rows = parseInt(prompt('Rows?', '3') || '0', 10);
    const cols = parseInt(prompt('Columns?', '3') || '0', 10);
    if (!rows || !cols) return;
    let html = '<table><thead><tr>';
    for (let c = 0; c < cols; c++) html += `<th>Header ${c + 1}</th>`;
    html += '</tr></thead><tbody>';
    for (let r = 0; r < rows; r++) {
      html += '<tr>';
      for (let c = 0; c < cols; c++) html += '<td>&nbsp;</td>';
      html += '</tr>';
    }
    html += '</tbody></table><p><br></p>';
    exec('insertHTML', html);
  });
  $('insertChecklist').addEventListener('click', () => {
    exec('insertHTML', '<div class="checklist-item"><input type="checkbox" onclick="this.parentElement.classList.toggle(\'checked\', this.checked)"><span>Task</span></div>');
  });

  // ------------ Header buttons ------------
  $('newNoteBtn').addEventListener('click', newNote);
  $('pinBtn').addEventListener('click', () => {
    const n = activeNote(); if (!n) return;
    n.pinned = !n.pinned; n.updatedAt = Date.now();
    persistNotes(); updatePinFav(); renderList();
    toast(n.pinned ? 'Pinned' : 'Unpinned');
  });
  $('favBtn').addEventListener('click', () => {
    const n = activeNote(); if (!n) return;
    n.favorite = !n.favorite; n.updatedAt = Date.now();
    persistNotes(); updatePinFav(); renderList();
    toast(n.favorite ? 'Favorited' : 'Unfavorited');
  });
  $('focusBtn').addEventListener('click', () => {
    document.body.classList.toggle('focus-mode');
    $('focusBtn').classList.toggle('active', document.body.classList.contains('focus-mode'));
    toast(document.body.classList.contains('focus-mode') ? 'Focus mode on' : 'Focus mode off');
  });
  $('zenBtn').addEventListener('click', () => {
    document.body.classList.toggle('zen');
    $('zenBtn').classList.toggle('active', document.body.classList.contains('zen'));
  });

  // Search & filter & sort
  searchInput.addEventListener('input', renderList);
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    document.querySelectorAll('.chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active');
    settings.filter = c.dataset.filter; persistSettings();
    renderList();
  }));
  sortSel.addEventListener('change', () => { settings.sortBy = sortSel.value; persistSettings(); renderList(); });

  // ------------ 3-dot menu ------------
  const morePanel = $('morePanel');
  const moreBtn = $('moreBtn');
  const toggleMenu = (open) => {
    const willOpen = open ?? !morePanel.classList.contains('open');
    morePanel.classList.toggle('open', willOpen);
  };
  moreBtn.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
  document.addEventListener('click', e => {
    if (!morePanel.contains(e.target) && e.target !== moreBtn) toggleMenu(false);
  });

  morePanel.addEventListener('click', e => {
    const item = e.target.closest('.menu-item');
    if (!item) return;
    const action = item.dataset.action;
    toggleMenu(false);
    handleMenuAction(action);
  });

  const handleMenuAction = (action) => {
    const n = activeNote(); if (!n) return;
    switch (action) {
      case 'export-txt': download(`${n.title}.txt`, stripHtml(n.content), 'text/plain'); break;
      case 'export-md': download(`${n.title}.md`, htmlToMd(n.content), 'text/markdown'); break;
      case 'export-html': download(`${n.title}.html`, buildHtmlDoc(n), 'text/html'); break;
      case 'export-pdf': exportPdf(n); break;
      case 'export-json': download(`${n.title}.json`, JSON.stringify(n, null, 2), 'application/json'); break;
      case 'import': $('fileInput').click(); break;
      case 'duplicate': {
        const c = { ...n, id: uid(), title: n.title + ' (copy)', createdAt: Date.now(), updatedAt: Date.now() };
        notes.unshift(c); persistNotes(); selectNote(c.id); toast('Duplicated');
        break;
      }
      case 'print': printNote(n); break;
      case 'trash': {
        n.trashed = true; n.trashedAt = Date.now(); persistNotes();
        const next = notes.find(x => !x.trashed);
        selectNote(next ? next.id : null);
        if (!next) { editor.innerHTML = ''; titleInput.value = ''; }
        renderList(); toast('Moved to trash');
        break;
      }
    }
  };

  // ------------ Export helpers ------------
  const download = (name, content, mime) => {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 500);
    toast('Downloaded ' + name);
  };

  const htmlToMd = (html) => {
    let s = html;
    s = s.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n');
    s = s.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n');
    s = s.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n');
    s = s.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**');
    s = s.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**');
    s = s.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*');
    s = s.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*');
    s = s.replace(/<code[^>]*>(.*?)<\/code>/gi, '`$1`');
    s = s.replace(/<a [^>]*href="([^"]+)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)');
    s = s.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<\/p>/gi, '\n\n');
    s = s.replace(/<[^>]+>/g, '');
    return s.replace(/\n{3,}/g, '\n\n').trim();
  };

  const buildHtmlDoc = (n) => `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>${escapeHtml(n.title)}</title>
<style>body{font-family:Georgia,serif;max-width:720px;margin:40px auto;padding:0 20px;line-height:1.7;color:#222}h1,h2,h3{font-family:Georgia,serif}</style></head>
<body><h1>${escapeHtml(n.title)}</h1>${n.content}</body></html>`;

  const printNote = (n) => {
    const w = window.open('', '_blank');
    w.document.write(buildHtmlDoc(n));
    w.document.close();
    setTimeout(() => w.print(), 300);
  };
  const exportPdf = (n) => {
    // Uses browser Print → Save as PDF (universal, no library needed)
    printNote(n);
    toast('Use "Save as PDF" in the print dialog');
  };

  // ------------ Import ------------
  $('fileInput').addEventListener('change', e => {
    Array.from(e.target.files || []).forEach(readFile);
    e.target.value = '';
  });

  const readFile = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      const txt = reader.result;
      const name = file.name.replace(/\.[^.]+$/, '');
      let n = makeNote();
      n.title = name;
      if (file.name.endsWith('.json')) {
        try {
          const parsed = JSON.parse(txt);
          if (Array.isArray(parsed)) {
            parsed.forEach(p => notes.unshift({ ...makeNote(), ...p, id: uid() }));
            persistNotes(); renderList(); toast(`Imported ${parsed.length} notes`); return;
          }
          n = { ...n, ...parsed, id: uid() };
        } catch {
          n.content = `<pre>${escapeHtml(txt)}</pre>`;
        }
      } else if (file.name.endsWith('.html')) {
        n.content = txt;
      } else if (file.name.endsWith('.md') || file.name.endsWith('.markdown')) {
        n.content = mdToHtml(txt);
      } else {
        n.content = txt.split('\n').map(l => `<p>${escapeHtml(l) || '<br>'}</p>`).join('');
      }
      notes.unshift(n); persistNotes(); selectNote(n.id); toast('Imported ' + file.name);
    };
    reader.readAsText(file);
  };

  const mdToHtml = (md) => {
    let s = escapeHtml(md);
    s = s.replace(/^### (.*)$/gm, '<h3>$1</h3>');
    s = s.replace(/^## (.*)$/gm, '<h2>$1</h2>');
    s = s.replace(/^# (.*)$/gm, '<h1>$1</h1>');
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/\*(.+?)\*/g, '<em>$1</em>');
    s = s.replace(/`(.+?)`/g, '<code>$1</code>');
    s = s.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');
    s = s.replace(/^- (.*)$/gm, '<li>$1</li>');
    s = s.replace(/(<li>.*<\/li>\n?)+/g, m => '<ul>' + m + '</ul>');
    s = s.split(/\n\n+/).map(p => /^<(h\d|ul|ol|pre|blockquote)/.test(p) ? p : `<p>${p.replace(/\n/g, '<br>')}</p>`).join('');
    return s;
  };

  // ------------ Drag & drop ------------
  const drop = $('dropOverlay');
  let dragCount = 0;
  window.addEventListener('dragenter', e => {
    if (!e.dataTransfer || !e.dataTransfer.types.includes('Files')) return;
    dragCount++; drop.classList.remove('hidden');
  });
  window.addEventListener('dragover', e => { e.preventDefault(); });
  window.addEventListener('dragleave', e => {
    dragCount--; if (dragCount <= 0) { drop.classList.add('hidden'); dragCount = 0; }
  });
  window.addEventListener('drop', e => {
    e.preventDefault(); dragCount = 0; drop.classList.add('hidden');
    Array.from(e.dataTransfer.files || []).forEach(readFile);
  });

  // ------------ Copy all / Delete all ------------
  $('copyAllBtn').addEventListener('click', async () => {
    const text = editor.innerText || stripHtml(editor.innerHTML);
    if (!text.trim()) return toast('Nothing to copy', 'error');
    try {
      await navigator.clipboard.writeText(text);
      toast('Copied all text', 'success');
      $('copyAllBtn').classList.add('pulse');
      setTimeout(() => $('copyAllBtn').classList.remove('pulse'), 900);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); ta.remove();
      toast('Copied', 'success');
    }
  });
  $('deleteAllBtn').addEventListener('click', () => {
    if (!editor.innerHTML.trim()) return toast('Already empty');
    if (!confirm('Delete all text in this note?')) return;
    editor.innerHTML = '';
    scheduleSave();
    toast('Cleared', 'success');
  });

  // ------------ Mobile sidebar ------------
  const openSidebar = () => document.body.classList.add('sidebar-open');
  const closeSidebar = () => document.body.classList.remove('sidebar-open');
  $('menuBtn').addEventListener('click', openSidebar);
  $('sidebarClose').addEventListener('click', closeSidebar);
  $('backdrop').addEventListener('click', closeSidebar);

  // ------------ Command palette ------------
  const cmdPalette = $('cmdPalette');
  const cmdInput = $('cmdInput');
  const cmdResults = $('cmdResults');
  const commands = [
    { name: 'New note', run: newNote, kbd: 'Ctrl+N' },
    { name: 'Toggle focus mode', run: () => $('focusBtn').click() },
    { name: 'Toggle zen mode', run: () => $('zenBtn').click() },
    { name: 'Export as PDF', run: () => handleMenuAction('export-pdf') },
    { name: 'Export as Markdown', run: () => handleMenuAction('export-md') },
    { name: 'Export as TXT', run: () => handleMenuAction('export-txt') },
    { name: 'Export as JSON', run: () => handleMenuAction('export-json') },
    { name: 'Import file', run: () => handleMenuAction('import') },
    { name: 'Duplicate note', run: () => handleMenuAction('duplicate') },
    { name: 'Move to trash', run: () => handleMenuAction('trash') },
    { name: 'Theme: Light', run: () => applyTheme('light') },
    { name: 'Theme: Dark', run: () => applyTheme('dark') },
    { name: 'Theme: AMOLED', run: () => applyTheme('amoled') },
    { name: 'Theme: Sepia', run: () => applyTheme('sepia') },
    { name: 'Copy all text', run: () => $('copyAllBtn').click() },
    { name: 'Delete all text', run: () => $('deleteAllBtn').click() },
  ];
  const openCmd = () => {
    cmdPalette.classList.remove('hidden');
    cmdInput.value = ''; renderCmd('');
    setTimeout(() => cmdInput.focus(), 50);
  };
  const closeCmd = () => cmdPalette.classList.add('hidden');
  const renderCmd = (q) => {
    const ql = q.toLowerCase();
    const cmds = commands.filter(c => c.name.toLowerCase().includes(ql));
    const noteMatches = q ? notes.filter(n => !n.trashed && (n.title.toLowerCase().includes(ql) || stripHtml(n.content).toLowerCase().includes(ql))).slice(0, 5) : [];
    cmdResults.innerHTML = '';
    cmds.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = 'cmd-result' + (i === 0 ? ' selected' : '');
      el.innerHTML = `<span>⚡</span><span>${c.name}</span>${c.kbd ? `<span class="kbd">${c.kbd}</span>` : ''}`;
      el.addEventListener('click', () => { closeCmd(); c.run(); });
      cmdResults.appendChild(el);
    });
    noteMatches.forEach(n => {
      const el = document.createElement('div');
      el.className = 'cmd-result';
      el.innerHTML = `<span>📄</span><span>${escapeHtml(n.title)}</span>`;
      el.addEventListener('click', () => { closeCmd(); selectNote(n.id); });
      cmdResults.appendChild(el);
    });
  };
  cmdInput.addEventListener('input', () => renderCmd(cmdInput.value));
  cmdInput.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeCmd();
    if (e.key === 'Enter') { const s = cmdResults.querySelector('.cmd-result.selected') || cmdResults.querySelector('.cmd-result'); s && s.click(); }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const all = [...cmdResults.querySelectorAll('.cmd-result')];
      const i = all.findIndex(x => x.classList.contains('selected'));
      all.forEach(x => x.classList.remove('selected'));
      const ni = e.key === 'ArrowDown' ? Math.min(all.length - 1, i + 1) : Math.max(0, i - 1);
      all[ni] && all[ni].classList.add('selected');
    }
  });
  cmdPalette.addEventListener('click', e => { if (e.target === cmdPalette) closeCmd(); });
  $('cmdPaletteBtn').addEventListener('click', openCmd);

  // ------------ Keyboard shortcuts ------------
  document.addEventListener('keydown', e => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'k') { e.preventDefault(); openCmd(); }
    if (mod && e.key.toLowerCase() === 'n') { e.preventDefault(); newNote(); }
    if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); scheduleSave(); toast('Saved'); }
    if (mod && e.key.toLowerCase() === 'p') { e.preventDefault(); $('pinBtn').click(); }
    if (e.key === 'F11') { e.preventDefault(); $('zenBtn').click(); }
    if (e.key === 'Escape') { closeCmd(); document.body.classList.remove('zen'); }
  });

  // ------------ Toast ------------
  function toast(msg, kind = '') {
    const t = document.createElement('div');
    t.className = 'toast ' + kind;
    t.textContent = msg;
    $('toasts').appendChild(t);
    setTimeout(() => { t.style.opacity = 0; t.style.transform = 'translateY(10px)'; }, 1800);
    setTimeout(() => t.remove(), 2200);
  }

  // ------------ Boot ------------
  applyTheme(settings.theme);
  sortSel.value = settings.sortBy;
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c.dataset.filter === settings.filter));
  if (!notes.length) {
    const welcome = makeNote();
    welcome.title = 'Welcome to TinyNote';
    welcome.content = `<h1>Welcome to TinyNote</h1><p><em>fast · private · offline</em></p>
<p>Every keystroke saves locally. Nothing leaves your device.</p>
<h2>Try these</h2>
<ul>
<li>Press <code>Ctrl+K</code> to open the command palette</li>
<li>Drop a <code>.txt</code>, <code>.md</code> or <code>.json</code> file anywhere</li>
<li>Use the ⋮ menu to export as PDF, Markdown, or HTML</li>
<li>Copy or clear the whole note with the buttons at the bottom right</li>
</ul>
<blockquote>Enjoy the calm.</blockquote>`;
    notes.push(welcome); persistNotes();
    settings.activeId = welcome.id; persistSettings();
  }
  if (!settings.activeId || !activeNote()) {
    const first = notes.find(n => !n.trashed);
    settings.activeId = first ? first.id : null; persistSettings();
  }
  selectNote(settings.activeId);
})();
