/* Fungsi bantu bersama untuk halaman dosen */
(function () {
  'use strict';
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  function el(tag, attrs, ...anak) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === 'class') n.className = v;
        else if (k === 'text') n.textContent = v;
        else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
        else if (k === 'checked' || k === 'value' || k === 'selected' || k === 'disabled') n[k] = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const a of anak.flat(Infinity)) {
      if (a == null || a === false) continue;
      n.append(a instanceof Node ? a : document.createTextNode(String(a)));
    }
    return n;
  }

  const lokal = {
    ambil(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
    taruh(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* penuh / privat */ } },
    hapus(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } }
  };

  const huruf = (i) => String.fromCharCode(65 + i);
  const angka = (v, d = 2) => (v == null || Number.isNaN(Number(v)) ? '–' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }));
  const tanggal = (t) => (t ? new Date(t).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '–');
  const idAcak = () => Math.random().toString(36).slice(2, 10);

  let toastWaktu;
  function toast(pesan, jenis = '') {
    const t = $('#toast');
    if (!t) return;
    t.textContent = pesan;
    t.className = `toast ${jenis}`;
    t.hidden = false;
    clearTimeout(toastWaktu);
    toastWaktu = setTimeout(() => { t.hidden = true; }, jenis === 'galat' ? 7000 : 3500);
  }

  function unduh(namaFile, isi, tipe) {
    const a = el('a', { href: URL.createObjectURL(new Blob([isi], { type: tipe })), download: namaFile });
    document.body.append(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  function csv(baris) {
    const sel = (v) => {
      const s = v == null ? '' : String(v);
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    // titik koma + BOM agar langsung rapi di Excel berbahasa Indonesia
    return '﻿' + baris.map((r) => r.map(sel).join(';')).join('\r\n');
  }

  window.U = { $, $$, el, lokal, huruf, angka, tanggal, idAcak, toast, unduh, csv };
})();
