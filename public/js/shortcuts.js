// shortcuts.js — global keyboard: Ctrl+K, Alt+T/W/[/], Esc, Delete, ?.
export function wireShortcuts(ctx) {
  const help = document.getElementById('help-modal');
  document.addEventListener('keydown', (e) => {
    const inInput = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    const modK = (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k';
    if (modK) { e.preventDefault(); ctx.search.open(); return; }
    if (e.key === 'Escape') {
      if (ctx.search.isOpen) { ctx.search.close(); return; }
      if (!document.getElementById('pine-modal').hidden) { ctx.pine.close(); return; }
      if (!help.hidden) { help.hidden = true; return; }
      ctx.chart.deselect();
      ctx.chart.armTool('select');
      ctx.syncRail();
      return;
    }
    if (inInput) return;
    if (e.altKey && e.key.toLowerCase() === 't') { e.preventDefault(); ctx.tabs.add(); }
    else if (e.altKey && e.key.toLowerCase() === 'w') { e.preventDefault(); ctx.tabs.close(ctx.activeTabId()); }
    else if (e.altKey && e.key === '[') { e.preventDefault(); ctx.tabs.step(-1); }
    else if (e.altKey && e.key === ']') { e.preventDefault(); ctx.tabs.step(1); }
    else if (e.key === 'Delete' || e.key === 'Backspace') {
      // delete the selected drawing, if any
      try {
        const id = selectedId(ctx);
        if (id) ctx.chart.chart.drawings.remove(id);
      } catch { /* */ }
    }
    else if (e.key === '?') { help.hidden = !help.hidden; }
  });
  document.getElementById('btn-help').onclick = () => { help.hidden = !help.hidden; };
}

// best-effort: find the currently selected drawing id via the drawings store
function selectedId(ctx) {
  try {
    const d = ctx.chart.chart.drawings;
    if (typeof d.all === 'function') {
      const all = d.all();
      const sel = all.find((x) => x.selected);
      return sel ? sel.id : null;
    }
  } catch { /* */ }
  return null;
}
