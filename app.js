/* =========================================================
   CBT Multi-Metode — aplikasi ujian mahasiswa
   Tanpa pustaka luar. Memanggil fungsi RPC Supabase (PostgREST) via fetch.
   ========================================================= */
(() => {
  'use strict';

  const CFG = window.CBT_CONFIG || {};
  const KUNCI_TOKEN = 'cbt_token';
  const HURUF = (i) => String.fromCharCode(65 + i);

  // ---------- utilitas ----------
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
        else if (k === 'checked' || k === 'value' || k === 'selected') n[k] = v;
        else n.setAttribute(k, v === true ? '' : v);
      }
    }
    for (const a of anak.flat()) {
      if (a == null || a === false) continue;
      n.append(a instanceof Node ? a : document.createTextNode(String(a)));
    }
    return n;
  }

  const simpanLokal = {
    ambil(k) { try { return localStorage.getItem(k); } catch { return null; } },
    taruh(k, v) { try { localStorage.setItem(k, v); } catch { /* mode privat */ } },
    hapus(k) { try { localStorage.removeItem(k); } catch { /* abaikan */ } }
  };

  function teksOpsi(o) { return o == null ? '' : (typeof o === 'object' ? (o.teks ?? '') : String(o)); }

  // ---------- RPC ----------
  async function rpc(fn, args) {
    let res;
    try {
      res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/rpc/${fn}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: CFG.SUPABASE_ANON_KEY,
          Authorization: `Bearer ${CFG.SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify(args)
      });
    } catch {
      const e = new Error('Tidak dapat terhubung ke server. Periksa koneksi internet Anda.');
      e.jaringan = true;
      throw e;
    }
    const teks = await res.text();
    let data = null;
    try { data = teks ? JSON.parse(teks) : null; } catch { data = teks; }
    if (!res.ok) {
      const e = new Error((data && data.message) || `Server menolak permintaan (kode ${res.status}).`);
      e.status = res.status;
      throw e;
    }
    return data;
  }

  // ---------- keadaan ----------
  const S = {
    token: null,
    data: null,          // hasil ambil_soal
    soal: [],
    stimulus: new Map(),
    idx: 0,
    jawab: new Map(),    // soal_id -> { respon, ragu }
    antre: new Map(),    // soal_id -> timeout
    gagal: new Set(),
    sedangKirim: 0,
    batas: 0,            // Date.now() saat waktu habis
    detak: null,
    aktif: false,
    stimTampil: null,
    tab: 'soal',
    skala: 1,
    peringatanTertunda: null
  };

  // ---------- pindah layar ----------
  function tampilkan(id) {
    for (const l of $$('.layar')) l.hidden = l.id !== id;
  }

  // =========================================================
  // MASUK
  // =========================================================
  function siapkanMasuk() {
    $('#nama-institusi').textContent = CFG.NAMA_INSTITUSI || '';
    const form = $('#form-masuk');
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const kode = String(f.get('kode') || '').trim();
      const nama = String(f.get('nama') || '').trim();
      const nim = String(f.get('nim') || '').trim();
      const galat = $('#galat-masuk');
      galat.hidden = true;
      if (!kode || !nama || !nim) {
        galat.textContent = 'Isi kode ujian, nama, dan NIM terlebih dahulu.';
        galat.hidden = false;
        return;
      }
      const tombol = $('#tombol-masuk');
      tombol.disabled = true;
      tombol.textContent = 'Menghubungkan…';
      try {
        const r = await rpc('gabung_ujian', {
          p_kode: kode, p_nama: nama, p_nim: nim, p_kelas: String(f.get('kelas') || '').trim() || null
        });
        S.token = r.token;
        simpanLokal.taruh(KUNCI_TOKEN, r.token);
        await mulaiUjian();
      } catch (e) {
        galat.textContent = e.message;
        galat.hidden = false;
      } finally {
        tombol.disabled = false;
        tombol.textContent = 'Mulai ujian';
      }
    });
  }

  // =========================================================
  // UJIAN
  // =========================================================
  async function mulaiUjian() {
    tampilkan('layar-muat');
    const d = await rpc('ambil_soal', { p_token: S.token });
    if (d.status !== 'mengerjakan') return tampilHasil();

    S.data = d;
    S.soal = d.soal;
    S.stimulus = new Map(d.stimulus.map((s) => [s.id, s]));
    S.jawab = new Map(d.soal.map((s) => [s.id, { respon: s.jawaban ?? null, ragu: !!s.ragu }]));
    S.idx = 0;
    S.stimTampil = null;

    $('#judul-ujian').textContent = d.ujian.judul;
    const p = d.peserta;
    $('#identitas-peserta').textContent = `${p.nama} (${p.nim})${p.kelas ? ', ' + p.kelas : ''}, paket ${p.paket}`;
    document.title = `${d.ujian.judul} | Ujian Online`;

    S.batas = Date.now() + d.sisa_detik * 1000;
    S.aktif = true;
    mulaiTimer();
    bangunDaftar();
    statusSimpan();
    tampilkan('layar-ujian');
    bukaSoal(0);
  }

  // ---------- timer ----------
  function mulaiTimer() {
    clearInterval(S.detak);
    const t = $('#timer');
    const tick = () => {
      const sisa = Math.max(0, Math.round((S.batas - Date.now()) / 1000));
      const j = Math.floor(sisa / 3600), m = Math.floor((sisa % 3600) / 60), d = sisa % 60;
      const dua = (x) => String(x).padStart(2, '0');
      t.textContent = j > 0 ? `${j}:${dua(m)}:${dua(d)}` : `${dua(m)}:${dua(d)}`;
      t.classList.toggle('menipis', sisa <= 300);
      t.setAttribute('aria-label', `Sisa waktu ${m + j * 60} menit ${d} detik`);
      if (sisa <= 0 && S.aktif) {
        clearInterval(S.detak);
        kumpulkan('waktu');
      }
    };
    tick();
    S.detak = setInterval(tick, 1000);
  }

  // ---------- status jawaban ----------
  function sudahDijawab(soal, respon) {
    if (respon == null) return false;
    const k = soal.konten;
    switch (soal.tipe) {
      case 'pg': return Number.isInteger(respon.pilih);
      case 'pg_kompleks': return Array.isArray(respon.pilih) && respon.pilih.length > 0;
      case 'benar_salah': return Array.isArray(respon.pilih) && respon.pilih.length === (k.pernyataan || []).length && respon.pilih.every((x) => typeof x === 'boolean');
      case 'menjodohkan': return Array.isArray(respon.pilih) && respon.pilih.length === (k.kiri || []).length && respon.pilih.every((x) => Number.isInteger(x));
      case 'isian_singkat':
      case 'uraian': return typeof respon.teks === 'string' && respon.teks.trim() !== '';
      case 'three_tier': return Number.isInteger(respon.pilih) && Number.isInteger(respon.alasan) && typeof respon.yakin === 'boolean';
      default: return false;
    }
  }

  function terisiSebagian(soal, respon) {
    if (respon == null) return false;
    if (soal.tipe === 'three_tier') return [respon.pilih, respon.alasan, respon.yakin].some((x) => x != null);
    if (Array.isArray(respon.pilih)) return respon.pilih.some((x) => x != null);
    return false;
  }

  // ---------- daftar soal (LJK) ----------
  function bangunDaftar() {
    const grid = $('#grid-soal');
    grid.replaceChildren();
    const adaBacaan = S.soal.some((s) => s.stimulus_id);
    let kel = null, kunciKel, nomorBacaan = 0;
    S.soal.forEach((s, i) => {
      const kunci = s.stimulus_id || null;
      if (i === 0 || kunci !== kunciKel) {
        kel = el('div', { class: 'kelompok' });
        if (kunci) {
          nomorBacaan++;
          const st = S.stimulus.get(kunci);
          kel.append(el('h3', null, `Bacaan ${nomorBacaan}`, st?.judul ? el('span', { text: `: ${st.judul}` }) : null));
        } else if (adaBacaan) {
          kel.append(el('h3', { text: 'Soal tanpa bacaan' }));
        }
        kel.append(el('div', { class: 'butir-grid' }));
        grid.append(kel);
        kunciKel = kunci;
      }
      $('.butir-grid', kel).append(el('button', {
        class: 'butir', 'data-i': i, text: i + 1,
        onclick: () => { bukaSoal(i); tutupDaftar(); }
      }));
    });
    perbaruiDaftar();
  }

  function perbaruiDaftar() {
    $$('.butir').forEach((b) => {
      const i = Number(b.dataset.i);
      const s = S.soal[i];
      const j = S.jawab.get(s.id);
      const terisi = sudahDijawab(s, j.respon);
      b.classList.toggle('terisi', terisi && !j.ragu);
      b.classList.toggle('ragu', j.ragu);
      b.classList.toggle('aktif', i === S.idx);
      b.setAttribute('aria-label', `Soal ${i + 1}, ${j.ragu ? 'ragu-ragu' : terisi ? 'sudah dijawab' : 'belum dijawab'}`);
      if (i === S.idx) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
    });
  }

  function bukaDaftar() {
    perbaruiDaftar();
    $('#panel-daftar').hidden = false;
    $('#tirai-daftar').hidden = false;
    $('#tombol-daftar').setAttribute('aria-expanded', 'true');
    $('.butir.aktif')?.focus();
  }
  function tutupDaftar() {
    $('#panel-daftar').hidden = true;
    $('#tirai-daftar').hidden = true;
    $('#tombol-daftar').setAttribute('aria-expanded', 'false');
  }

  // ---------- bacaan ----------
  function renderBacaan(st) {
    const art = $('#isi-bacaan');
    art.replaceChildren();
    const k = st.konten || {};
    if (st.judul) art.append(el('h2', { text: st.judul }));
    (k.paragraf || []).forEach((p, i) => {
      art.append(el('div', { class: 'paragraf' }, el('b', { 'aria-label': `Paragraf ${i + 1}`, text: `¶${i + 1}` }), el('p', { text: p })));
    });
    if (k.tabel && Array.isArray(k.tabel.baris)) {
      const t = el('table');
      if (Array.isArray(k.tabel.kolom)) t.append(el('thead', null, el('tr', null, k.tabel.kolom.map((c) => el('th', { scope: 'col', text: c })))));
      t.append(el('tbody', null, k.tabel.baris.map((r) => el('tr', null, r.map((c) => el('td', { text: c }))))));
      art.append(t);
    }
    (k.gambar || []).forEach((g) => {
      art.append(el('figure', null, el('img', { src: g.url, alt: g.keterangan || 'Gambar bacaan', loading: 'lazy' }), g.keterangan ? el('figcaption', { text: g.keterangan }) : null));
    });
    if (k.sumber) art.append(el('p', { class: 'sumber', text: `Sumber: ${k.sumber}` }));

    const nomor = [...new Set(S.soal.map((s) => s.stimulus_id).filter(Boolean))].indexOf(st.id) + 1;
    const anggota = S.soal.map((s, i) => [s, i]).filter(([s]) => s.stimulus_id === st.id).map(([, i]) => i + 1);
    $('#label-bacaan').textContent = anggota.length > 1 ? `Bacaan ${nomor}, untuk soal ${anggota[0]}–${anggota[anggota.length - 1]}` : `Bacaan ${nomor}, untuk soal ${anggota[0]}`;
    $('#panel-bacaan').scrollTop = 0;
  }

  // ---------- soal ----------
  const PETUNJUK = {
    pg: 'Pilih satu jawaban.',
    pg_kompleks: 'Pilih semua jawaban yang benar. Bisa lebih dari satu.',
    benar_salah: 'Tentukan benar atau salah untuk setiap pernyataan.',
    menjodohkan: 'Pasangkan setiap item dengan pilihan yang sesuai.',
    isian_singkat: 'Ketik jawaban singkat.',
    three_tier: 'Jawab ketiga bagian: jawaban, alasan, dan keyakinan Anda.',
    uraian: 'Tulis jawaban Anda.'
  };

  function bukaSoal(i) {
    if (i < 0 || i >= S.soal.length) return;
    S.idx = i;
    const s = S.soal[i];
    const j = S.jawab.get(s.id);
    const badan = $('#badan-ujian');
    const st = s.stimulus_id ? S.stimulus.get(s.stimulus_id) : null;

    // bacaan
    badan.classList.toggle('dengan-bacaan', !!st);
    $('#panel-bacaan').hidden = !st;
    $('#tab-hp').hidden = !st;
    if (st && S.stimTampil !== st.id) {
      renderBacaan(st);
      S.stimTampil = st.id;
      if (window.matchMedia('(max-width: 860px)').matches) pilihTab('bacaan');
    }
    if (!st) S.stimTampil = null;
    if (st && !window.matchMedia('(max-width: 860px)').matches) pilihTab('soal');

    // kepala soal
    $('#nomor-soal').textContent = `Soal ${i + 1} dari ${S.soal.length}`;
    $('#petunjuk-soal').textContent = PETUNJUK[s.tipe] || '';

    // isi
    const wadah = $('#isi-soal');
    wadah.replaceChildren();
    const k = s.konten;
    if (k.gambar && typeof k.gambar === 'string') wadah.append(el('img', { class: 'gambar-soal', src: k.gambar, alt: 'Gambar soal' }));
    wadah.append(el('p', { class: 'pertanyaan', id: `tanya-${s.id}`, text: k.pertanyaan }));
    const pembuat = PENYAJI[s.tipe];
    if (pembuat) wadah.append(pembuat(s, j.respon, (respon, segera = true) => ubahJawaban(s, respon, segera)));

    // kaki
    $('#cek-ragu').checked = j.ragu;
    $('#tombol-sebelum').disabled = i === 0;
    const terakhir = i === S.soal.length - 1;
    $('#tombol-berikut').textContent = terakhir ? 'Selesai' : 'Berikutnya';

    $('#panel-soal').scrollTop = 0;
    perbaruiDaftar();
  }

  function pilihTab(t) {
    S.tab = t;
    const badan = $('#badan-ujian');
    badan.classList.toggle('tab-soal', t === 'soal');
    badan.classList.toggle('tab-bacaan', t === 'bacaan');
    $$('#tab-hp [role=tab]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === t)));
  }

  // ---------- penyaji per tipe ----------
  function daftarOpsi(nama, opsi, terpilih, jamak, labelledby, onUbah) {
    const box = el('div', { class: 'pilihan', role: jamak ? 'group' : 'radiogroup', 'aria-labelledby': labelledby });
    opsi.forEach((o, pos) => {
      const masuk = el('input', {
        type: jamak ? 'checkbox' : 'radio', name: nama, value: o.i,
        checked: jamak ? (terpilih || []).includes(o.i) : terpilih === o.i,
        onchange: () => {
          if (jamak) onUbah($$(`input[name="${nama}"]:checked`, box).map((x) => Number(x.value)));
          else onUbah(Number(masuk.value));
        }
      });
      box.append(el('label', { class: `opsi${jamak ? ' kotak' : ''}` }, masuk, el('span', { class: 'bul-huruf', 'aria-hidden': 'true', text: HURUF(pos) }), el('span', { class: 'teks', text: teksOpsi(o) })));
    });
    return box;
  }

  const PENYAJI = {
    pg(s, r, ubah) {
      return daftarOpsi(`s-${s.id}`, s.konten.opsi, r?.pilih, false, `tanya-${s.id}`, (v) => ubah({ pilih: v }));
    },

    pg_kompleks(s, r, ubah) {
      return daftarOpsi(`s-${s.id}`, s.konten.opsi, r?.pilih, true, `tanya-${s.id}`, (v) => ubah(v.length ? { pilih: v } : null));
    },

    benar_salah(s, r, ubah) {
      const n = s.konten.pernyataan.length;
      const pil = Array.from({ length: n }, (_, i) => (r?.pilih?.[i] ?? null));
      const label = s.konten.label || ['Benar', 'Salah'];
      const tb = el('table', { class: 'tabel-bs' });
      s.konten.pernyataan.forEach((p, i) => {
        const nama = `bs-${s.id}-${i}`;
        const pilihan = [true, false].map((nilai, x) => el('label', null,
          el('input', { type: 'radio', name: nama, checked: pil[i] === nilai, 'aria-label': `${label[x]}: ${p}`,
            onchange: () => { pil[i] = nilai; ubah({ pilih: [...pil] }); } }),
          el('span', { text: label[x] })));
        tb.append(el('tr', null, el('td', { text: p }), el('td', null, el('span', { class: 'pil-bs' }, pilihan))));
      });
      return tb;
    },

    menjodohkan(s, r, ubah) {
      const { kiri, kanan } = s.konten;
      const pil = Array.from({ length: kiri.length }, (_, i) => (r?.pilih?.[i] ?? null));
      const box = el('div', { class: 'jodoh' });
      kiri.forEach((item, i) => {
        const pilih = el('select', {
          'aria-label': `Pasangan untuk ${teksOpsi(item)}`,
          onchange: (ev) => {
            pil[i] = ev.target.value === '' ? null : Number(ev.target.value);
            baris.classList.toggle('terisi', pil[i] != null);
            ubah({ pilih: [...pil] });
          }
        }, el('option', { value: '', text: 'Pilih pasangan…' }),
          kanan.map((o, pos) => el('option', { value: o.i, selected: pil[i] === o.i, text: `${HURUF(pos)}. ${teksOpsi(o)}` })));
        const baris = el('div', { class: `jodoh-baris${pil[i] != null ? ' terisi' : ''}` }, el('div', { text: teksOpsi(item) }), pilih);
        box.append(baris);
      });
      return box;
    },

    isian_singkat(s, r, ubah) {
      const masuk = el('input', {
        type: 'text', value: r?.teks || '', autocomplete: 'off', spellcheck: 'false',
        'aria-labelledby': `tanya-${s.id}`, placeholder: 'Jawaban Anda',
        oninput: () => ubah(masuk.value.trim() ? { teks: masuk.value } : null, false),
        onblur: () => ubah(masuk.value.trim() ? { teks: masuk.value } : null, true)
      });
      return el('div', { class: 'isian-singkat' }, masuk, s.konten.satuan ? el('span', { text: s.konten.satuan }) : null);
    },

    three_tier(s, r, ubah) {
      const cur = { pilih: r?.pilih ?? null, alasan: r?.alasan ?? null, yakin: r?.yakin ?? null };
      const kirim = () => ubah({ ...cur });
      const label = s.konten.keyakinan || ['Yakin', 'Tidak yakin'];
      const t1 = el('section', { class: 'tingkat' }, el('h3', { id: `t1-${s.id}`, text: 'Bagian 1: jawaban' }),
        daftarOpsi(`t1-${s.id}`, s.konten.opsi, cur.pilih, false, `t1-${s.id}`, (v) => { cur.pilih = v; kirim(); }));
      const t2 = el('section', { class: 'tingkat' }, el('h3', { id: `t2-${s.id}`, text: 'Bagian 2: alasan' }),
        daftarOpsi(`t2-${s.id}`, s.konten.alasan, cur.alasan, false, `t2-${s.id}`, (v) => { cur.alasan = v; kirim(); }));
      const opsiYakin = [{ i: 0, teks: label[0] }, { i: 1, teks: label[1] }];
      const t3 = el('section', { class: 'tingkat' }, el('h3', { id: `t3-${s.id}`, text: 'Bagian 3: seberapa yakin Anda?' }),
        daftarOpsi(`t3-${s.id}`, opsiYakin, cur.yakin == null ? null : (cur.yakin ? 0 : 1), false, `t3-${s.id}`, (v) => { cur.yakin = v === 0; kirim(); }));
      return el('div', null, t1, t2, t3);
    },

    uraian(s, r, ubah) {
      const maks = Number(s.konten.maks_kata) || 0;
      const hitung = el('div', { class: 'hitung-kata' });
      const perbarui = () => {
        const n = area.value.trim() ? area.value.trim().split(/\s+/).length : 0;
        hitung.textContent = maks ? `${n} / ${maks} kata` : `${n} kata`;
        hitung.classList.toggle('lewat', maks > 0 && n > maks);
      };
      const area = el('textarea', {
        'aria-labelledby': `tanya-${s.id}`, placeholder: 'Tulis jawaban Anda di sini',
        oninput: () => { perbarui(); ubah(area.value.trim() ? { teks: area.value } : null, false); },
        onblur: () => ubah(area.value.trim() ? { teks: area.value } : null, true)
      });
      area.value = r?.teks || '';
      perbarui();
      return el('div', { class: 'uraian' }, area, hitung);
    }
  };

  // ---------- autosave ----------
  function ubahJawaban(s, respon, segera) {
    const j = S.jawab.get(s.id);
    j.respon = respon;
    perbaruiDaftar();
    jadwalkanSimpan(s.id, segera ? 0 : 800);
  }

  function jadwalkanSimpan(id, jeda) {
    clearTimeout(S.antre.get(id));
    S.antre.set(id, setTimeout(() => kirimJawaban(id), jeda));
    statusSimpan();
  }

  async function kirimJawaban(id, coba = 0) {
    S.antre.delete(id);
    const j = S.jawab.get(id);
    S.sedangKirim++;
    statusSimpan();
    try {
      const r = await rpc('simpan_jawaban', { p_token: S.token, p_soal_id: id, p_respon: j.respon, p_ragu: j.ragu });
      S.gagal.delete(id);
      if (r && r.ok === false && S.aktif) {
        S.sedangKirim--;
        statusSimpan();
        return kumpulkan(r.alasan === 'waktu_habis' ? 'waktu' : 'server');
      }
    } catch (e) {
      S.gagal.add(id);
      if (S.aktif) {
        const jeda = Math.min(15000, 2000 * (coba + 1));
        S.antre.set(id, setTimeout(() => kirimJawaban(id, coba + 1), jeda));
      }
    }
    S.sedangKirim--;
    statusSimpan();
  }

  function statusSimpan() {
    const st = $('#status-simpan');
    if (S.gagal.size) { st.textContent = `${S.gagal.size} jawaban belum tersimpan, mencoba lagi…`; st.classList.add('gagal'); return; }
    st.classList.remove('gagal');
    st.textContent = (S.sedangKirim || S.antre.size) ? 'Menyimpan…' : 'Semua jawaban tersimpan';
  }

  async function kirimSemuaAntrean() {
    const id = [...new Set([...S.antre.keys(), ...S.gagal])];
    for (const x of id) clearTimeout(S.antre.get(x));
    S.antre.clear();
    await Promise.all(id.map(async (x) => {
      const j = S.jawab.get(x);
      try {
        await rpc('simpan_jawaban', { p_token: S.token, p_soal_id: x, p_respon: j.respon, p_ragu: j.ragu });
        S.gagal.delete(x);
      } catch { /* dilaporkan lewat S.gagal */ }
    }));
    // tunggu pengiriman yang masih berjalan
    for (let t = 0; S.sedangKirim > 0 && t < 50; t++) await new Promise((ok) => setTimeout(ok, 100));
    statusSimpan();
  }

  // ---------- pindah tab ----------
  async function laporPindahTab() {
    if (!S.aktif) return;
    try {
      const r = await rpc('catat_aktivitas', { p_token: S.token, p_jenis: 'pindah_tab' });
      if (r.terkunci || r.status === 'selesai') {
        S.aktif = false;
        clearInterval(S.detak);
        return tampilHasil();
      }
      if (r.maks_pindah_tab > 0) {
        const n = r.jumlah_pindah_tab, maks = r.maks_pindah_tab;
        S.peringatanTertunda = n < maks
          ? `Tercatat ${n} dari ${maks} kali yang diizinkan. Jika lebih dari ${maks} kali, jawaban Anda dikumpulkan otomatis.`
          : `Ini batas terakhir (${n} dari ${maks} kali). Jika Anda meninggalkan halaman sekali lagi, jawaban dikumpulkan otomatis.`;
        if (!document.hidden) tampilPeringatan();
      }
    } catch { /* jaringan: abaikan, dicoba saat berikutnya */ }
  }

  function tampilPeringatan() {
    if (!S.peringatanTertunda || !S.aktif) return;
    $('#teks-peringatan').textContent = S.peringatanTertunda;
    S.peringatanTertunda = null;
    const d = $('#dialog-peringatan');
    if (!d.open) d.showModal();
  }

  // ---------- kumpulkan ----------
  function bukaDialogKumpul() {
    let terjawab = 0, ragu = 0, sebagian = 0;
    for (const s of S.soal) {
      const j = S.jawab.get(s.id);
      if (sudahDijawab(s, j.respon)) terjawab++;
      else if (terisiSebagian(s, j.respon)) sebagian++;
      if (j.ragu) ragu++;
    }
    const kosong = S.soal.length - terjawab;
    const box = el('div', { class: 'ringkas' },
      el('div', null, el('b', { text: terjawab }), el('span', { text: 'Sudah dijawab' })),
      el('div', { class: kosong ? 'waspada' : '' }, el('b', { text: kosong }), el('span', { text: 'Belum lengkap' })),
      el('div', null, el('b', { text: ragu }), el('span', { text: 'Ragu-ragu' })));
    $('#ringkas-kumpul').replaceChildren(box,
      sebagian ? el('p', { class: 'redup', text: `${sebagian} soal baru dijawab sebagian.` }) : '');
    tutupDaftar();
    $('#dialog-kumpul').showModal();
  }

  async function kumpulkan(sebab) {
    if (!S.aktif) return;
    S.aktif = false;
    clearInterval(S.detak);
    $('#dialog-kumpul').open && $('#dialog-kumpul').close();
    tampilkan('layar-muat');
    $('#layar-muat p').textContent = sebab === 'waktu' ? 'Waktu habis. Mengumpulkan jawaban…' : 'Mengumpulkan jawaban…';
    await kirimSemuaAntrean();
    for (let coba = 0; coba < 5; coba++) {
      try {
        const h = await rpc('kumpulkan_ujian', { p_token: S.token });
        return renderHasil(h, sebab);
      } catch (e) {
        if (!e.jaringan) return renderGalat(e.message);
        $('#layar-muat p').textContent = 'Koneksi terputus. Mencoba mengumpulkan lagi…';
        await new Promise((ok) => setTimeout(ok, 3000));
      }
    }
    renderGalat('Jawaban belum terkumpul karena koneksi terputus. Muat ulang halaman ini setelah internet kembali; jawaban Anda yang sudah tersimpan tidak hilang.');
  }

  // =========================================================
  // HASIL
  // =========================================================
  async function tampilHasil() {
    tampilkan('layar-muat');
    try {
      const h = await rpc('lihat_hasil', { p_token: S.token });
      renderHasil(h);
    } catch (e) {
      renderGalat(e.message);
    }
  }

  function renderGalat(pesan) {
    const box = $('#isi-hasil');
    box.replaceChildren(el('h1', { text: 'Ada masalah' }), el('p', { class: 'info waspada', text: pesan }));
    tampilkan('layar-hasil');
  }

  const KATEGORI_TT = {
    paham: 'Paham konsep',
    paham_kurang_yakin: 'Paham, tetapi kurang yakin',
    miskonsepsi: 'Miskonsepsi',
    tidak_paham: 'Belum paham konsep',
    tidak_dijawab: 'Tidak dijawab'
  };

  function teksKunci(d) {
    const k = d.kunci || {}, kt = d.konten || {};
    const opsiTeks = (arr, i) => (Array.isArray(arr) && arr[i] != null ? teksOpsi(arr[i]) : `opsi ${i + 1}`);
    switch (d.tipe) {
      case 'pg': return opsiTeks(kt.opsi, k.jawaban);
      case 'pg_kompleks': return (k.jawaban || []).map((i) => opsiTeks(kt.opsi, i)).join('; ');
      case 'benar_salah': return (k.jawaban || []).map((b, i) => `${i + 1}) ${b ? 'Benar' : 'Salah'}`).join(', ');
      case 'menjodohkan': return (kt.kiri || []).map((x, i) => `${teksOpsi(x)} → ${opsiTeks(kt.kanan, k.jawaban?.[i])}`).join('; ');
      case 'isian_singkat': return (k.jawaban || []).join(' / ') || (k.numerik ? String(k.numerik.nilai) : '');
      case 'three_tier': return `${opsiTeks(kt.opsi, k.jawaban)}. Alasan: ${opsiTeks(kt.alasan, k.alasan)}`;
      default: return '';
    }
  }

  function renderHasil(h, sebab) {
    S.aktif = false;
    clearInterval(S.detak);
    const box = $('#isi-hasil');
    box.replaceChildren();
    box.append(el('h1', { text: 'Ujian selesai' }));

    const alasan = h.alasan_selesai || (sebab === 'waktu' ? 'waktu_habis' : null);
    if (alasan === 'pelanggaran') box.append(el('p', { class: 'info waspada', text: 'Jawaban dikumpulkan otomatis karena Anda meninggalkan halaman ujian melebihi batas yang diizinkan.' }));
    else if (alasan === 'waktu_habis') box.append(el('p', { class: 'info', text: 'Waktu ujian habis. Jawaban yang sudah tersimpan telah dikumpulkan.' }));
    else if (alasan === 'ditutup_dosen') box.append(el('p', { class: 'info', text: 'Ujian ditutup oleh dosen. Jawaban yang sudah tersimpan telah dikumpulkan.' }));

    if (h.pesan) {
      box.append(el('p', { text: h.pesan }));
    } else {
      const r = h.ringkasan || {};
      box.append(el('div', { class: 'kotak-nilai' },
        el('div', { class: 'angka', text: h.nilai == null ? '–' : Number(h.nilai).toLocaleString('id-ID', { maximumFractionDigits: 2 }) }),
        el('div', null,
          el('p', null, el('strong', { text: h.nama }), ` (${h.nim})`),
          el('p', { class: 'redup', text: `${r.jumlah_benar ?? 0} dari ${r.jumlah_soal ?? 0} soal benar${r.tidak_dijawab ? `, ${r.tidak_dijawab} tidak dijawab` : ''}` }))));
      if (r.menunggu_penilaian) box.append(el('p', { class: 'info', text: 'Sebagian jawaban uraian masih menunggu penilaian dosen, jadi nilai ini belum final.' }));

      if (Array.isArray(r.per_bacaan) && r.per_bacaan.length) {
        box.append(el('section', { class: 'bagian-hasil' }, el('h2', { text: 'Hasil per bacaan' }),
          r.per_bacaan.map((b) => el('div', { class: 'batang-baris' },
            el('span', { text: b.judul || b.kode }),
            el('span', { class: 'batang', role: 'img', 'aria-label': `${b.benar} dari ${b.jumlah} benar` }, el('i', { style: `width:${b.jumlah ? (100 * b.benar / b.jumlah) : 0}%` })),
            el('span', { class: 'n', text: `${b.benar}/${b.jumlah}` })))));
      }
      const tt = r.three_tier || {};
      const totTT = Object.values(tt).reduce((a, b) => a + b, 0);
      if (totTT) {
        box.append(el('section', { class: 'bagian-hasil' }, el('h2', { text: 'Pemahaman konsep (three-tier)' }),
          Object.keys(KATEGORI_TT).filter((k) => tt[k]).map((k) => el('div', { class: 'batang-baris' },
            el('span', { text: KATEGORI_TT[k] }),
            el('span', { class: 'batang', role: 'img', 'aria-label': `${tt[k]} soal` }, el('i', { style: `width:${100 * tt[k] / totTT}%` })),
            el('span', { class: 'n', text: `${tt[k]} soal` })))));
      }
      if (Array.isArray(h.detail)) {
        box.append(el('section', { class: 'bagian-hasil' }, el('h2', { text: 'Pembahasan' }),
          h.detail.map((d) => {
            const tanda = d.tipe === 'uraian'
              ? el('span', { class: 'tanda netral', text: d.skor == null ? 'Menunggu penilaian' : 'Sudah dinilai' })
              : el('span', { class: `tanda ${d.benar ? 'ya' : 'tidak'}`, text: d.benar ? 'Benar' : 'Salah' });
            const kunci = teksKunci(d);
            return el('div', { class: 'bahas' },
              el('div', { class: 'kepala' }, el('span', { text: `Soal ${d.no}` }), tanda, d.kategori && KATEGORI_TT[d.kategori] && d.tipe === 'three_tier' ? el('span', { class: 'redup', text: KATEGORI_TT[d.kategori] }) : null),
              el('p', { text: d.pertanyaan }),
              kunci ? el('p', null, el('strong', { text: 'Kunci: ' }), kunci) : null,
              d.pembahasan ? el('p', { class: 'redup', text: d.pembahasan }) : null);
          })));
      }
    }

    box.append(el('div', { class: 'aksi-hasil' }, el('button', {
      class: 'tombol garis', text: 'Keluar',
      onclick: () => { simpanLokal.hapus(KUNCI_TOKEN); S.token = null; location.reload(); }
    })));
    tampilkan('layar-hasil');
  }

  // =========================================================
  // PASANG EVENT & MULAI
  // =========================================================
  function pasangEvent() {
    $('#tombol-sebelum').addEventListener('click', () => bukaSoal(S.idx - 1));
    $('#tombol-berikut').addEventListener('click', () => {
      if (S.idx === S.soal.length - 1) bukaDialogKumpul(); else bukaSoal(S.idx + 1);
    });
    $('#cek-ragu').addEventListener('change', (ev) => {
      const s = S.soal[S.idx];
      S.jawab.get(s.id).ragu = ev.target.checked;
      perbaruiDaftar();
      jadwalkanSimpan(s.id, 0);
    });
    $('#tombol-daftar').addEventListener('click', bukaDaftar);
    $('#tutup-daftar').addEventListener('click', tutupDaftar);
    $('#tirai-daftar').addEventListener('click', tutupDaftar);
    $('#tombol-kumpul').addEventListener('click', bukaDialogKumpul);
    $('#batal-kumpul').addEventListener('click', () => $('#dialog-kumpul').close());
    $('#ya-kumpul').addEventListener('click', () => kumpulkan('manual'));
    $('#ok-peringatan').addEventListener('click', () => $('#dialog-peringatan').close());
    $$('#tab-hp [role=tab]').forEach((b) => b.addEventListener('click', () => pilihTab(b.dataset.tab)));
    $$('[data-huruf]').forEach((b) => b.addEventListener('click', () => {
      S.skala = Math.min(1.4, Math.max(0.85, S.skala + Number(b.dataset.huruf) * 0.1));
      document.documentElement.style.setProperty('--skala-baca', S.skala.toFixed(2));
    }));
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && !$('#panel-daftar').hidden) tutupDaftar();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) laporPindahTab();
      else tampilPeringatan();
    });
    window.addEventListener('beforeunload', (ev) => {
      if (S.aktif && (S.antre.size || S.gagal.size)) { ev.preventDefault(); ev.returnValue = ''; }
    });
  }

  async function awal() {
    pasangEvent();
    siapkanMasuk();
    if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('xxxx')) {
      tampilkan('layar-masuk');
      const g = $('#galat-masuk');
      g.textContent = 'Alamat Supabase belum diatur. Isi SUPABASE_URL dan SUPABASE_ANON_KEY di file config.js.';
      g.hidden = false;
      return;
    }
    S.token = simpanLokal.ambil(KUNCI_TOKEN);
    if (!S.token) return tampilkan('layar-masuk');
    try {
      await mulaiUjian();
    } catch (e) {
      tampilkan('layar-masuk');
      const g = $('#galat-masuk');
      if (e.jaringan) {
        g.textContent = `${e.message} Setelah tersambung, masuk lagi dengan NIM yang sama untuk melanjutkan.`;
        g.hidden = false;
      } else {
        simpanLokal.hapus(KUNCI_TOKEN);
        S.token = null;
      }
    }
  }

  awal();
})();
