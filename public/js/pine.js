// pine.js — Pine editor modal. Overlays only (no Pine-as-scan in v1 — noted in the UI).
import { toast } from './tabs.js';

const DEFAULT_CODE = `//@version=6
indicator("My Overlay", overlay=true)
// דוגמה: ממוצע נע 20 בזהב של 7-DIGITS
plot(ta.sma(close, 20), "SMA20", color.new(#c9a227, 0), 2)`;

export class PineUI {
  constructor(chart7d, getTab, saveTab) {
    this.c7 = chart7d; this.getTab = getTab; this.saveTab = saveTab;
    this.modal = document.getElementById('pine-modal');
    this.code = document.getElementById('pine-code');
    this.err = document.getElementById('pine-error');
    this.code.value = localStorage.getItem('7d.pine.draft') || DEFAULT_CODE;
    this.code.addEventListener('input', () => localStorage.setItem('7d.pine.draft', this.code.value));
  }

  open() { this.modal.hidden = false; this.err.hidden = true; setTimeout(() => this.code.focus(), 30); }
  close() { this.modal.hidden = true; }

  wire() {
    document.getElementById('btn-pine').onclick = () => this.open();
    document.querySelectorAll('.modal-close').forEach((b) => b.onclick = () => document.getElementById(b.dataset.close).hidden = true);
    document.getElementById('pine-run').onclick = () => this.run();
    document.getElementById('pine-clear').onclick = () => {
      this.c7.clearPine();
      const t = this.getTab(); if (t) { t.pine = []; this.saveTab(); }
      toast('אינדיקטורי Pine נוקו');
    };
    this.modal.addEventListener('click', (e) => { if (e.target === this.modal) this.close(); });
  }

  run() {
    const src = this.code.value;
    this.err.hidden = true;
    try {
      const h = this.c7.runPine(src);
      const key = 'pine-' + Date.now().toString(36);
      this.c7.trackPine(key, h);
      const t = this.getTab();
      if (t) { t.pine = [...(t.pine || []), src]; this.saveTab(); }
      toast('האינדיקטור הורץ על הגרף');
      this.close();
    } catch (e) {
      this.err.textContent = 'שגיאה: ' + (e?.message || e);
      this.err.hidden = false;
    }
  }
}
