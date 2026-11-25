/* =========================================================
   Ruang Dosen — login, daftar ujian, pembuat soal, nilai,
   penilaian uraian, analisis butir, diagnostik DINA/NPC.
   Memakai Supabase Auth + PostgREST langsung via fetch.
   ========================================================= */
(() => {
  'use strict';
  const { $, $$, el, lokal, huruf, angka, tanggal, toast, unduh, csv } = window.U;
  const CFG = window.CBT_CONFIG || {};
  const KUNCI_SESI = 'cbt_dosen_sesi';
  const isi = $('#isi');

  const NAMA_METODE = { pg: 'Pilihan ganda', literasi: 'Literasi', three_tier: 'Three-tier', dina: 'Diagnostik', kustom: 'Campuran' };
  const NAMA_MODEL = { klasik: 'Skor klasik', three_tier: 'Kategori three-tier', dina: 'DINA', npc: 'NPC' };
  const NAMA_STATUS = { draf: 'Draf', aktif: 'Dibuka', ditutup: 'Ditutup' };
  const NAMA_TIPE = window.Pembuat.TIPE;
  const KAT_TT = { paham: 'Paham', paham_kurang_yakin: 'Paham, kurang yakin', miskonsepsi: 'Miskonsepsi', tidak_paham: 'Belum paham', tidak_dijawab: 'Tidak dijawab' };
  const urutKode = (a, b) => String(a).localeCompare(String(b), 'id', { numeric: true });

  // =========================================================
  // AUTH & API
  // =========================================================
  const Auth = {
    sesi: lokal.ambil(KUNCI_SESI),
    simpan(d) {
      this.sesi = {
        access_token: d.access_token, refresh_token: d.refresh_token,
        expires_at: d.expires_at || Math.floor(Date.now() / 1000) + (d.expires_in || 3600),
        email: d.user?.email || this.sesi?.email || ''
      };
      lokal.taruh(KUNCI_SESI, this.sesi);
    },
    async minta(path, body) {
      let res;
      try {
        res = await fetch(`${CFG.SUPABASE_URL}/auth/v1/${path}`, {
          method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        });
      } catch { throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.'); }
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        const m = d.error_description || d.msg || d.message || '';
        throw new Error(/invalid login/i.test(m) ? 'Email atau kata sandi salah.' : /not confirmed/i.test(m) ? 'Email belum dikonfirmasi. Konfirmasi lewat email atau minta admin mengonfirmasi akun di Supabase.' : m || `Gagal masuk (kode ${res.status}).`);
      }
      return d;
    },
    async masuk(email, sandi) { this.simpan(await this.minta('token?grant_type=password', { email, password: sandi })); },
    async token() {
      if (!this.sesi) throw new Error('Belum masuk.');
      if (this.sesi.expires_at * 1000 - Date.now() < 60_000) {
        try { this.simpan(await this.minta('token?grant_type=refresh_token', { refresh_token: this.sesi.refresh_token })); }
        catch { this.keluar('Sesi Anda berakhir. Silakan masuk lagi.'); throw new Error('Sesi berakhir.'); }
      }
      return this.sesi.access_token;
    },
    keluar(pesan) {
      const t = this.sesi?.access_token;
      if (t) fetch(`${CFG.SUPABASE_URL}/auth/v1/logout`, { method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${t}` } }).catch(() => {});
      this.sesi = null;
      lokal.hapus(KUNCI_SESI);
      if (pesan) sessionStorage.setItem('pesan_masuk', pesan);
      location.hash = '#/masuk';
    }
  };

  async function api(method, path, { body, prefer } = {}) {
    const t = await Auth.token();
    let res;
    try {
      res = await fetch(`${CFG.SUPABASE_URL}/rest/v1/${path}`, {
        method,
        headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: `Bearer ${t}`, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        body: body === undefined ? undefined : JSON.stringify(body)
      });
    } catch { throw new Error('Tidak dapat terhubung ke server. Periksa koneksi internet.'); }
    if (res.status === 401) { Auth.keluar('Sesi Anda berakhir. Silakan masuk lagi.'); throw new Error('Sesi berakhir.'); }
    const teks = await res.text();
    let d = null;
    try { d = teks ? JSON.parse(teks) : null; } catch { d = teks; }
    if (!res.ok) throw new Error((d && d.message) || `Server menolak permintaan (kode ${res.status}).`);
    return d;
  }
  const ambil = (path) => api('GET', path);
  const rpc = (fn, args) => api('POST', `rpc/${fn}`, { body: args });

  // =========================================================
  // KOMPONEN UMUM
  // =========================================================
  const tombol = (teks, aksi, kelas = 'garis', attrs = {}) => el('button', { type: 'button', class: `tombol ${kelas}`, onclick: aksi, ...attrs }, teks);
  const tambahKe = (wadah, ...anak) => wadah.append(...anak.flat(Infinity).filter((x) => x != null && x !== false));
  const chip = (teks, jenis) => el('span', { class: `chip ${jenis || ''}` }, teks);
  const chipStatus = (s) => chip(NAMA_STATUS[s] || s, `status-${s}`);
  const halaman = (...anak) => { isi.replaceChildren(el('div', { class: 'halaman' }, ...anak)); window.scrollTo(0, 0); };
  const memuat = (teks = 'Memuat…') => halaman(el('p', { class: 'redup memuat', text: teks }));
  const kosong = (teks, ...aksi) => el('div', { class: 'kosong' }, el('p', { text: teks }), aksi.length ? el('div', { class: 'aksi-baris' }, ...aksi) : null);
  const tabel = (kepala, baris, kelas = '') => el('div', { class: 'gulir-tabel' },
    el('table', { class: `tabel ${kelas}` },
      el('thead', null, el('tr', null, kepala.map((k) => el('th', { scope: 'col', class: k.kelas || '' }, k.teks ?? k)))),
      el('tbody', null, baris)));
  function galatHalaman(e) {
    halaman(el('h1', { text: 'Halaman tidak dapat dimuat' }), el('p', { class: 'info waspada', text: e.message }),
      el('div', { class: 'aksi-baris' }, tombol('Coba lagi', () => rute()), el('a', { href: '#/', class: 'tombol garis' }, 'Ke daftar ujian')));
  }

  // =========================================================
  // RUTE
  // =========================================================
  let dataImpor = null;

  async function rute() {
    const h = location.hash.replace(/^#/, '') || '/';
    if (!Auth.sesi && h !== '/masuk') { location.hash = '#/masuk'; return; }
    if (Auth.sesi && h === '/masuk') { location.hash = '#/'; return; }
    $('#bilah').hidden = !Auth.sesi;
    $('#email-dosen').textContent = Auth.sesi?.email || '';
    const [a, b, c] = h.split('/').filter(Boolean);
    try {
      if (h === '/masuk') return halMasuk();
      if (!a) return await halDaftar();
      if (a === 'buat') return halBuat();
      if (a === 'impor') return halImpor();
      if (a === 'ubah' && b) return await halUbah(b);
      if (a === 'ujian' && b) return await halDetail(b, c || 'ringkasan');
      return await halDaftar();
    } catch (e) {
      if (!/Sesi berakhir/.test(e.message)) galatHalaman(e);
    }
  }

  // =========================================================
  // MASUK
  // =========================================================
  function halMasuk() {
    const pesan = sessionStorage.getItem('pesan_masuk');
    sessionStorage.removeItem('pesan_masuk');
    const galat = el('p', { class: 'pesan-galat', role: 'alert', hidden: !pesan || null, text: pesan || '' });
    const form = el('form', { novalidate: true },
      el('label', { class: 'isian' }, el('span', null, 'Email'), el('input', { name: 'email', type: 'email', autocomplete: 'username', required: true })),
      el('label', { class: 'isian' }, el('span', null, 'Kata sandi'), el('input', { name: 'sandi', type: 'password', autocomplete: 'current-password', required: true })),
      galat,
      el('button', { type: 'submit', class: 'tombol utama lebar' }, 'Masuk'),
      el('p', { class: 'catatan', text: 'Akun dosen dibuat oleh pengelola di Supabase (Authentication → Users). Mahasiswa tidak perlu akun; mereka masuk lewat halaman ujian.' }));
    form.addEventListener('submit', async (ev) => {
      ev.preventDefault();
      const f = new FormData(form);
      const btn = $('button[type=submit]', form);
      galat.hidden = true;
      if (!f.get('email') || !f.get('sandi')) { galat.textContent = 'Isi email dan kata sandi.'; galat.hidden = false; return; }
      btn.disabled = true; btn.textContent = 'Masuk…';
      try {
        await Auth.masuk(String(f.get('email')).trim(), String(f.get('sandi')));
        location.hash = '#/';
      } catch (e) {
        galat.textContent = e.message; galat.hidden = false;
        btn.disabled = false; btn.textContent = 'Masuk';
      }
    });
    isi.replaceChildren(el('div', { class: 'masuk' }, el('div', { class: 'masuk-kartu' },
      el('div', { class: 'masuk-kepala' },
        el('div', { class: 'masuk-bulatan', 'aria-hidden': 'true' }, el('span'), el('span', { class: 'isi' }), el('span'), el('span')),
        el('h1', { text: 'Ruang Dosen' }),
        el('p', { class: 'redup', text: CFG.NAMA_INSTITUSI || '' })),
      form)));
    $('input[name=email]', form).focus();
  }

  // =========================================================
  // DAFTAR UJIAN
  // =========================================================
  async function halDaftar() {
    memuat();
    const [ujian, rekap] = await Promise.all([
      ambil('ujian?select=id,judul,mata_kuliah,kode_ujian,preset,model_penilaian,status,dibuat&order=dibuat.desc'),
      ambil('v_rekap_nilai?select=ujian_id,status')
    ]);
    const hitung = new Map();
    rekap.forEach((r) => {
      const h = hitung.get(r.ujian_id) || { selesai: 0, jalan: 0 };
      if (r.status === 'selesai') h.selesai++; else h.jalan++;
      hitung.set(r.ujian_id, h);
    });
    const kepala = el('div', { class: 'kepala-halaman' },
      el('h1', { text: 'Ujian saya' }),
      el('div', { class: 'aksi-baris' },
        el('a', { href: '#/impor', class: 'tombol garis' }, 'Impor JSON'),
        el('a', { href: '#/buat', class: 'tombol utama' }, 'Buat ujian')));
    if (!ujian.length) {
      return halaman(kepala, kosong('Belum ada ujian. Buat ujian pertama Anda, atau impor soal dari file JSON.',
        el('a', { href: '#/buat', class: 'tombol utama' }, 'Buat ujian'), el('a', { href: '#/impor', class: 'tombol garis' }, 'Impor JSON')));
    }
    const baris = ujian.map((u) => {
      const h = hitung.get(u.id) || { selesai: 0, jalan: 0 };
      const ke = `#/ujian/${u.id}`;
      return el('tr', { class: 'baris-klik', onclick: (e) => { if (!e.target.closest('a')) location.hash = ke; } },
        el('td', { 'data-label': 'Ujian' }, el('a', { href: ke, class: 'judul-ujian' }, u.judul), u.mata_kuliah ? el('div', { class: 'redup kecil', text: u.mata_kuliah }) : null),
        el('td', { 'data-label': 'Metode' }, NAMA_METODE[u.preset] || u.preset),
        el('td', { 'data-label': 'Kode' }, el('strong', { class: 'kode-ujian' }, u.kode_ujian)),
        el('td', { 'data-label': 'Status' }, chipStatus(u.status)),
        el('td', { 'data-label': 'Peserta', class: 'angka' }, h.selesai + h.jalan ? `${h.selesai} selesai${h.jalan ? `, ${h.jalan} mengerjakan` : ''}` : '–'),
        el('td', { 'data-label': 'Dibuat', class: 'redup' }, tanggal(u.dibuat)));
    });
    halaman(kepala, tabel(['Ujian', 'Metode', 'Kode', 'Status', { teks: 'Peserta', kelas: 'angka' }, 'Dibuat'], baris, 'tabel-ujian'));
  }

  // =========================================================
  // BUAT / UBAH / IMPOR
  // =========================================================
  function halBuat() {
    const data = dataImpor;
    dataImpor = null;
    const wadah = el('div', { class: 'pembuat' });
    halaman(wadah);
    window.Pembuat.buka(wadah, {
      mode: 'baru', data, kunciDraf: data ? 'cbt_draf_impor' : 'cbt_draf_baru', drafDipakai: !!data,
      onSimpan: async (json) => {
        const r = await rpc('impor_ujian', { p_data: json });
        laporPeringatan(r, 'Ujian tersimpan');
        location.hash = `#/ujian/${r.ujian_id}`;
      }
    });
  }

  async function halUbah(id) {
    memuat();
    const data = await rpc('ekspor_ujian', { p_ujian_id: id });
    const wadah = el('div', { class: 'pembuat' });
    halaman(wadah);
    window.Pembuat.buka(wadah, {
      mode: 'ganti', data, kunciDraf: `cbt_draf_${id}`, kembali: `#/ujian/${id}`,
      onSimpan: async (json) => {
        const r = await rpc('ganti_ujian', { p_ujian_id: id, p_data: json });
        laporPeringatan(r, 'Perubahan tersimpan');
        location.hash = `#/ujian/${r.ujian_id}`;
      }
    });
  }

  function laporPeringatan(r, teksOk) {
    const w = r.peringatan || [];
    toast(w.length ? `${teksOk}. Catatan: ${w.join(' ')}` : `${teksOk}. Kode ujian: ${r.kode_ujian}`, w.length ? 'waspada' : 'ok');
  }

  function halImpor() {
    let data = null;
    const ringkas = el('div');
    const area = el('textarea', { rows: 12, class: 'teks-json', placeholder: '{ "ujian": { "judul": "…", "preset": "literasi" }, "stimulus": [ … ], "soal": [ … ] }', 'aria-label': 'Isi JSON' });
    const berkas = el('input', { type: 'file', accept: '.json,application/json', 'aria-label': 'Pilih file JSON' });
    const periksa = () => {
      ringkas.replaceChildren();
      data = null;
      const t = area.value.trim();
      if (!t) return;
      try { data = JSON.parse(t); } catch (e) {
        tambahKe(ringkas, el('p', { class: 'info waspada', text: `JSON tidak valid: ${e.message}` }));
        return;
      }
      const U = window.Pembuat.dariJSON(data);
      const v = window.Pembuat.validasi(U);
      tambahKe(ringkas, 
        el('dl', { class: 'ringkas-impor' },
          el('dt', null, 'Judul'), el('dd', null, data.ujian?.judul || '(kosong)'),
          el('dt', null, 'Metode'), el('dd', null, NAMA_METODE[data.ujian?.preset] || data.ujian?.preset || 'Pilihan ganda'),
          el('dt', null, 'Soal'), el('dd', null, `${(data.soal || []).length} soal`),
          el('dt', null, 'Bacaan'), el('dd', null, `${(data.stimulus || []).length}`),
          el('dt', null, 'Paket'), el('dd', null, `${(data.paket || []).length || 1}`)),
        v.galat.length ? el('div', { class: 'kotak-validasi' }, el('strong', { text: `${v.galat.length} hal perlu diperbaiki sebelum disimpan` }), el('ul', null, v.galat.slice(0, 8).map((g) => el('li', null, g.pesan)))) : null,
        el('div', { class: 'aksi-baris' },
          tombol('Periksa di pembuat soal', () => { dataImpor = data; location.hash = '#/buat'; }),
          tombol('Simpan langsung', async (e) => {
            e.target.disabled = true;
            try {
              const r = await rpc('impor_ujian', { p_data: data });
              laporPeringatan(r, 'Ujian diimpor');
              location.hash = `#/ujian/${r.ujian_id}`;
            } catch (err) {
              e.target.disabled = false;
              ringkas.prepend(el('p', { class: 'info waspada', role: 'alert', text: err.message }));
            }
          }, 'utama', { disabled: !!v.galat.length || null })));
    };
    area.addEventListener('input', periksa);
    berkas.addEventListener('change', async () => {
      const f = berkas.files[0];
      if (f) { area.value = await f.text(); periksa(); }
    });
    halaman(
      el('a', { href: '#/', class: 'tautan-kembali' }, 'Kembali'),
      el('h1', { text: 'Impor ujian dari JSON' }),
      el('p', { class: 'redup', text: 'Pilih file JSON atau tempel isinya. Format lengkapnya ada di README dan folder contoh-soal.' }),
      el('div', { class: 'kartu-polos' }, el('label', { class: 'kolom' }, el('span', { class: 'label' }, 'File JSON'), berkas), el('label', { class: 'kolom' }, el('span', { class: 'label' }, 'Atau tempel JSON'), area)),
      ringkas);
  }

  // =========================================================
  // DETAIL UJIAN
  // =========================================================
  async function halDetail(id, tab) {
    memuat();
    const [[u], soal, rekap] = await Promise.all([
      ambil(`ujian?id=eq.${id}&select=*`),
      ambil(`soal?ujian_id=eq.${id}&select=id,kode,tipe,stimulus_id,bobot,urutan&order=urutan`),
      ambil(`v_rekap_nilai?ujian_id=eq.${id}&select=*&order=nim`)
    ]);
    if (!u) return halaman(el('h1', { text: 'Ujian tidak ditemukan' }), el('p', { class: 'redup', text: 'Ujian ini mungkin sudah dihapus.' }), el('a', { href: '#/', class: 'tombol garis' }, 'Ke daftar ujian'));
    const adaUraian = soal.some((s) => s.tipe === 'uraian');
    const diagnostik = u.model_penilaian === 'dina' || u.model_penilaian === 'npc';
    const tabs = [['ringkasan', 'Ringkasan'], ['nilai', `Nilai (${rekap.length})`], adaUraian && ['uraian', 'Penilaian uraian'], ['analisis', 'Analisis butir'], diagnostik && ['diagnostik', 'Diagnostik']].filter(Boolean);
    if (!tabs.some(([k]) => k === tab)) tab = 'ringkasan';

    const statusAksi = u.status === 'aktif'
      ? tombol('Tutup ujian', async () => {
        const jalan = rekap.filter((r) => r.status !== 'selesai').length;
        if (!confirm(jalan ? `${jalan} mahasiswa masih mengerjakan. Jawaban mereka akan dikumpulkan sekarang. Tutup ujian?` : 'Tutup ujian? Mahasiswa tidak bisa masuk lagi.')) return;
        await rpc('tutup_ujian', { p_ujian_id: id });
        toast('Ujian ditutup', 'ok'); rute();
      }, 'garis')
      : tombol(u.status === 'ditutup' ? 'Buka lagi' : 'Buka ujian', async () => {
        await api('PATCH', `ujian?id=eq.${id}`, { body: { status: 'aktif' }, prefer: 'return=minimal' });
        toast(`Ujian dibuka. Bagikan kode ${u.kode_ujian} ke mahasiswa.`, 'ok'); rute();
      }, 'utama');

    const kepala = el('div', { class: 'kepala-detail' },
      el('a', { href: '#/', class: 'tautan-kembali' }, 'Semua ujian'),
      el('div', { class: 'judul-detail' },
        el('div', null,
          el('h1', { text: u.judul }),
          el('p', { class: 'redup' }, [u.mata_kuliah, `Metode ${NAMA_METODE[u.preset]}`, NAMA_MODEL[u.model_penilaian]].filter(Boolean).join(', '))),
        el('div', { class: 'kotak-kode' },
          el('span', { class: 'redup kecil' }, 'Kode ujian'),
          el('strong', { class: 'kode-besar' }, u.kode_ujian),
          chipStatus(u.status))),
      el('div', { class: 'aksi-baris' },
        statusAksi,
        rekap.length
          ? el('span', { class: 'tombol garis nonaktif', title: 'Soal tidak bisa diubah karena sudah ada mahasiswa yang mengerjakan. Gunakan Duplikat.', 'aria-disabled': 'true' }, 'Ubah soal')
          : el('a', { href: `#/ubah/${id}`, class: 'tombol garis' }, 'Ubah soal'),
        tombol('Duplikat', async () => {
          const d = await rpc('ekspor_ujian', { p_ujian_id: id });
          d.ujian.kode_ujian = null; d.ujian.status = 'draf'; d.ujian.judul = `${d.ujian.judul} (salinan)`;
          const r = await rpc('impor_ujian', { p_data: d });
          toast(`Salinan dibuat dengan kode ${r.kode_ujian}`, 'ok');
          location.hash = `#/ujian/${r.ujian_id}`;
        }),
        tombol('Unduh JSON', async () => {
          const d = await rpc('ekspor_ujian', { p_ujian_id: id });
          unduh(`${u.kode_ujian}.json`, JSON.stringify(d, null, 2), 'application/json');
        }),
        tombol('Hapus', async () => {
          const pesan = rekap.length
            ? `Ujian ini punya ${rekap.length} data mahasiswa. Semua soal, jawaban, dan nilai akan terhapus permanen dan tidak bisa dikembalikan.\n\nKetik kode ujian (${u.kode_ujian}) untuk menghapus:`
            : `Hapus ujian "${u.judul}" secara permanen? Ketik kode ujian (${u.kode_ujian}) untuk menghapus:`;
          if ((prompt(pesan) || '').trim().toUpperCase() !== u.kode_ujian) return;
          await api('DELETE', `ujian?id=eq.${id}`, { prefer: 'return=minimal' });
          toast('Ujian dihapus', 'ok'); location.hash = '#/';
        }, 'garis bahaya')),
      el('nav', { class: 'tab-detail', 'aria-label': 'Bagian ujian' },
        tabs.map(([k, t]) => el('a', { href: `#/ujian/${id}/${k}`, class: k === tab ? 'aktif' : '', 'aria-current': k === tab ? 'page' : null }, t))));

    const badan = el('div', { class: 'badan-tab' });
    halaman(kepala, badan);
    const konteks = { id, u, soal, rekap, badan };
    await ({ ringkasan: tabRingkasan, nilai: tabNilai, uraian: tabUraian, analisis: tabAnalisis, diagnostik: tabDiagnostik }[tab])(konteks);
  }

  // ---------- Ringkasan ----------
  function tabRingkasan({ id, u, soal, rekap, badan }) {
    const selesai = rekap.filter((r) => r.status === 'selesai').length;
    const tautan = new URL('index.html', location.href).href.split('#')[0];
    const perTipe = soal.reduce((m, s) => { m[s.tipe] = (m[s.tipe] || 0) + 1; return m; }, {});
    const p = { ...u.pengaturan };
    const z = (n) => String(n).padStart(2, '0');
    const lok = (iso) => { if (!iso) return ''; const d = new Date(iso); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`; };
    const num = (k, label, ket) => el('label', { class: 'kolom' }, el('span', { class: 'label' }, label), el('input', { type: 'number', min: 0, value: p[k] ?? '', oninput: (e) => { p[k] = Number(e.target.value); } }), ket ? el('span', { class: 'petunjuk-kolom' }, ket) : null);
    const wkt = (k, label) => el('label', { class: 'kolom' }, el('span', { class: 'label' }, label), el('input', { type: 'datetime-local', value: lok(p[k]), onchange: (e) => { p[k] = e.target.value ? new Date(e.target.value).toISOString() : null; } }));
    const skl = (k, label) => el('label', { class: 'saklar' }, el('input', { type: 'checkbox', checked: p[k] !== false && (p[k] ?? DEF[k]), onchange: (e) => { p[k] = e.target.checked; } }), el('span', null, label));
    const DEF = { tampilkan_skor: true, tampilkan_pembahasan: false, izinkan_lanjut: true };

    tambahKe(badan, 
      el('div', { class: 'statistik' },
        stat(soal.length, 'soal'), stat(new Set(soal.map((s) => s.stimulus_id).filter(Boolean)).size, 'bacaan'),
        stat(selesai, 'mahasiswa selesai'), stat(rekap.length - selesai, 'sedang mengerjakan')),
      el('section', { class: 'kartu-polos' },
        el('h2', { text: 'Bagikan ke mahasiswa' }),
        el('p', null, 'Mahasiswa membuka halaman ujian, lalu memasukkan kode ', el('strong', { text: u.kode_ujian }), ', nama, dan NIM.'),
        el('div', { class: 'baris-salin' }, el('input', { value: tautan, readonly: true, 'aria-label': 'Alamat halaman ujian' }),
          tombol('Salin alamat', () => navigator.clipboard?.writeText(`${tautan}\nKode ujian: ${u.kode_ujian}`).then(() => toast('Alamat dan kode ujian disalin', 'ok'))))),
      el('section', { class: 'kartu-polos' },
        el('h2', { text: 'Komposisi soal' }),
        el('ul', { class: 'daftar-tipe' }, Object.entries(perTipe).map(([t, n]) => el('li', null, el('span', null, NAMA_TIPE[t]), el('strong', null, n))))),
      el('section', { class: 'kartu-polos' },
        el('h2', { text: 'Pengaturan pelaksanaan' }),
        el('p', { class: 'redup kecil', text: 'Perubahan durasi hanya berlaku untuk mahasiswa yang masuk setelah disimpan.' }),
        el('div', { class: 'grid-3' }, num('durasi_menit', 'Durasi (menit)'), num('maks_pindah_tab', 'Batas pindah tab', 'Isi 0 untuk tidak membatasi.'), num('skala_nilai', 'Skala nilai')),
        el('div', { class: 'grid-2' }, wkt('waktu_mulai', 'Dibuka mulai'), wkt('waktu_selesai', 'Ditutup pada')),
        el('div', { class: 'daftar-saklar' },
          skl('izinkan_lanjut', 'Mahasiswa yang terputus boleh masuk lagi dan melanjutkan'),
          skl('tampilkan_skor', 'Tampilkan nilai setelah mahasiswa selesai'),
          skl('tampilkan_pembahasan', 'Tampilkan kunci dan pembahasan setelah ujian ditutup')),
        el('div', { class: 'aksi-baris' },
          tombol('Simpan pengaturan', async () => {
            await api('PATCH', `ujian?id=eq.${id}`, { body: { pengaturan: p }, prefer: 'return=minimal' });
            toast('Pengaturan tersimpan', 'ok');
          }, 'utama'),
          rekap.some((r) => r.status !== 'selesai') ? tombol('Kumpulkan sesi yang waktunya habis', async () => {
            const n = await rpc('kumpulkan_kedaluwarsa', { p_ujian_id: id });
            toast(n ? `${n} sesi dikumpulkan` : 'Tidak ada sesi yang waktunya habis', 'ok'); rute();
          }) : null)));
  }
  const stat = (n, label) => el('div', { class: 'stat' }, el('strong', { text: n }), el('span', { class: 'redup', text: label }));

  // ---------- Nilai ----------
  function tabNilai({ u, rekap, badan }) {
    if (!rekap.length) return tambahKe(badan, kosong(u.status === 'aktif' ? 'Belum ada mahasiswa yang masuk. Bagikan kode ujian dari tab Ringkasan.' : 'Belum ada mahasiswa. Buka ujian terlebih dahulu agar mahasiswa bisa masuk.'));
    const selesai = rekap.filter((r) => r.status === 'selesai' && r.nilai != null).map((r) => Number(r.nilai));
    const rata = selesai.length ? selesai.reduce((a, b) => a + b, 0) / selesai.length : null;
    const alasan = { manual: 'Dikumpulkan', waktu_habis: 'Waktu habis', pelanggaran: 'Otomatis (pindah tab)', ditutup_dosen: 'Ditutup dosen' };
    const baris = rekap.map((r) => el('tr', null,
      el('td', { 'data-label': 'NIM' }, r.nim),
      el('td', { 'data-label': 'Nama' }, r.nama),
      el('td', { 'data-label': 'Kelas' }, r.kelas || '–'),
      el('td', { 'data-label': 'Paket' }, r.paket),
      el('td', { 'data-label': 'Status' }, r.status === 'selesai' ? chip(alasan[r.alasan_selesai] || 'Selesai', r.alasan_selesai === 'pelanggaran' ? 'bahaya' : 'selesai') : chip('Mengerjakan', 'jalan')),
      el('td', { 'data-label': 'Nilai', class: 'angka' }, el('strong', null, angka(r.nilai)), r.menunggu_penilaian ? el('span', { class: 'redup kecil', title: 'Masih ada uraian yang belum dinilai' }, ' *') : null),
      el('td', { 'data-label': 'Benar', class: 'angka' }, r.jumlah_benar ?? '–'),
      el('td', { 'data-label': 'Pindah tab', class: 'angka' }, r.jumlah_pindah_tab),
      el('td', { 'data-label': 'Selesai', class: 'redup' }, tanggal(r.selesai))));
    tambahKe(badan, 
      el('div', { class: 'statistik' },
        stat(selesai.length, 'nilai masuk'), stat(angka(rata), 'rata-rata'),
        stat(selesai.length ? angka(Math.max(...selesai)) : '–', 'tertinggi'), stat(selesai.length ? angka(Math.min(...selesai)) : '–', 'terendah')),
      el('div', { class: 'aksi-baris' },
        tombol('Muat ulang', () => rute()),
        tombol('Unduh CSV (Excel)', () => unduh(`nilai-${u.kode_ujian}.csv`, csv([
          ['NIM', 'Nama', 'Kelas', 'Paket', 'Status', 'Nilai', 'Jumlah benar', 'Pindah tab', 'Mulai', 'Selesai'],
          ...rekap.map((r) => [r.nim, r.nama, r.kelas, r.paket, r.status === 'selesai' ? (alasan[r.alasan_selesai] || 'Selesai') : 'Mengerjakan', r.nilai == null ? '' : String(r.nilai).replace('.', ','), r.jumlah_benar, r.jumlah_pindah_tab, tanggal(r.mulai), tanggal(r.selesai)])
        ]), 'text/csv;charset=utf-8'))),
      tabel(['NIM', 'Nama', 'Kelas', 'Paket', 'Status', { teks: 'Nilai', kelas: 'angka' }, { teks: 'Benar', kelas: 'angka' }, { teks: 'Pindah tab', kelas: 'angka' }, 'Selesai'], baris),
      rekap.some((r) => r.menunggu_penilaian) ? el('p', { class: 'redup kecil', text: '* Nilai belum final karena masih ada jawaban uraian yang belum dinilai.' }) : null);
  }

  // ---------- Penilaian uraian ----------
  async function tabUraian({ id, badan }) {
    const data = await ambil(`v_jawaban_uraian?ujian_id=eq.${id}&select=*&order=nim`);
    if (!data.length) return tambahKe(badan, kosong('Belum ada jawaban uraian dari mahasiswa yang sudah selesai.'));
    let hanyaBelum = true;
    const wadah = el('div');
    const gambar = () => {
      wadah.replaceChildren();
      const perSoal = new Map();
      data.forEach((d) => { if (!perSoal.has(d.soal_id)) perSoal.set(d.soal_id, []); perSoal.get(d.soal_id).push(d); });
      [...perSoal.values()].sort((a, b) => urutKode(a[0].soal_kode, b[0].soal_kode)).forEach((daftar) => {
        const s = daftar[0];
        const tampil = daftar.filter((d) => !hanyaBelum || !d.skor_manual);
        wadah.append(el('section', { class: 'kartu-polos' },
          el('h2', null, `Soal ${s.soal_kode.replace(/^S/, '')}`),
          el('p', { class: 'pertanyaan-kecil', text: s.pertanyaan }),
          Array.isArray(s.rubrik) && s.rubrik.length ? el('ul', { class: 'rubrik' }, s.rubrik.map((r) => el('li', null, el('span', null, r.kriteria), el('strong', null, r.skor)))) : null,
          el('p', { class: 'redup kecil', text: `${daftar.filter((d) => d.skor_manual).length} dari ${daftar.length} sudah dinilai. Skor maksimal ${angka(s.skor_maks_rubrik)}.` }),
          tampil.length ? tampil.map((d) => kartuUraian(d)) : el('p', { class: 'redup', text: 'Semua jawaban soal ini sudah dinilai.' })));
      });
    };
    const kartuUraian = (d) => {
      const skor = el('input', { type: 'number', min: 0, max: d.skor_maks_rubrik, step: 0.5, value: d.skor_manual ? Number(d.skor) / Number(d.bobot) * Number(d.skor_maks_rubrik) : '', 'aria-label': `Skor untuk ${d.nama}` });
      const cat = el('input', { value: d.catatan || '', placeholder: 'Catatan untuk mahasiswa (opsional)', 'aria-label': `Catatan untuk ${d.nama}` });
      const status = d.skor_manual ? chip('Sudah dinilai', 'selesai') : chip('Belum dinilai', 'jalan');
      const kartu = el('div', { class: 'jawaban-uraian' },
        el('div', { class: 'kepala-jawaban' }, el('strong', null, d.nama), el('span', { class: 'redup' }, ` ${d.nim}${d.kelas ? ', ' + d.kelas : ''}`), status),
        el('p', { class: 'teks-jawaban', text: d.teks || '(tidak menjawab)' }),
        el('div', { class: 'baris-nilai' },
          el('label', { class: 'kolom sempit' }, el('span', { class: 'label' }, `Skor (0–${angka(d.skor_maks_rubrik)})`), skor),
          el('label', { class: 'kolom lebar' }, el('span', { class: 'label' }, 'Catatan'), cat),
          tombol('Simpan nilai', async (e) => {
            const v = Number(String(skor.value).replace(',', '.'));
            if (skor.value === '' || Number.isNaN(v) || v < 0 || v > Number(d.skor_maks_rubrik)) { toast(`Skor harus antara 0 dan ${angka(d.skor_maks_rubrik)}`, 'galat'); skor.focus(); return; }
            e.target.disabled = true;
            try {
              await rpc('nilai_uraian', { p_sesi_id: d.sesi_id, p_soal_id: d.soal_id, p_skor: v, p_catatan: cat.value.trim() || null });
              d.skor_manual = true; d.skor = v / Number(d.skor_maks_rubrik) * Number(d.bobot); d.catatan = cat.value.trim();
              toast(`Nilai ${d.nama} tersimpan`, 'ok');
              status.replaceWith(chip('Sudah dinilai', 'selesai'));
            } catch (err) { toast(err.message, 'galat'); }
            e.target.disabled = false;
          }, 'utama')));
      return kartu;
    };
    tambahKe(badan, el('div', { class: 'aksi-baris' },
      el('label', { class: 'saklar' }, el('input', { type: 'checkbox', checked: hanyaBelum, onchange: (e) => { hanyaBelum = e.target.checked; gambar(); } }), el('span', null, 'Tampilkan yang belum dinilai saja'))), wadah);
    gambar();
  }

  // ---------- Analisis butir ----------
  async function tabAnalisis({ id, u, rekap, badan }) {
    const [butir, sebaran, tt] = await Promise.all([
      ambil(`v_analisis_butir?ujian_id=eq.${id}&select=*`),
      ambil(`v_sebaran_opsi?ujian_id=eq.${id}&select=soal_kode,opsi,huruf,jumlah,kunci`),
      ambil(`v_three_tier?ujian_id=eq.${id}&select=soal_kode,kategori,jumlah,persen`)
    ]);
    if (!butir.length) return tambahKe(badan, kosong('Analisis muncul setelah ada mahasiswa yang selesai mengerjakan.'));
    butir.sort((a, b) => urutKode(a.soal_kode, b.soal_kode));
    const labelDB = (d) => (d == null ? ['–', ''] : d >= 0.4 ? ['Sangat baik', 'baik'] : d >= 0.3 ? ['Baik', 'baik'] : d >= 0.2 ? ['Cukup, perlu perbaikan', 'cukup'] : ['Perlu direvisi', 'buruk']);
    const opsiPer = new Map();
    sebaran.forEach((s) => { if (!opsiPer.has(s.soal_kode)) opsiPer.set(s.soal_kode, []); opsiPer.get(s.soal_kode).push(s); });
    const ttPer = new Map();
    tt.forEach((s) => { if (!ttPer.has(s.soal_kode)) ttPer.set(s.soal_kode, []); ttPer.get(s.soal_kode).push(s); });

    const baris = butir.map((b) => {
      const [lb, kls] = labelDB(b.daya_beda);
      const op = (opsiPer.get(b.soal_kode) || []).sort((x, y) => x.opsi - y.opsi);
      const totOp = op.reduce((t, x) => t + Number(x.jumlah), 0);
      const kat = ttPer.get(b.soal_kode) || [];
      return el('tr', null,
        el('td', { 'data-label': 'Soal' }, el('strong', null, b.soal_kode.replace(/^S/, ''))),
        el('td', { 'data-label': 'Tipe' }, NAMA_TIPE[b.tipe], b.bacaan ? el('div', { class: 'redup kecil', text: `Bacaan ${b.bacaan.replace(/^B/, '')}` }) : null),
        el('td', { 'data-label': 'N', class: 'angka' }, b.n),
        el('td', { 'data-label': 'Kesukaran (p)', class: 'angka' }, angka(b.p_kesukaran, 2), el('div', { class: 'redup kecil', text: b.kategori_kesukaran })),
        el('td', { 'data-label': 'Daya beda', class: 'angka' }, angka(b.daya_beda, 2), el('div', { class: `kecil db-${kls}`, text: lb })),
        el('td', { 'data-label': 'Sebaran jawaban' },
          op.length ? el('div', { class: 'sebaran' }, op.map((x) => el('span', { class: `seb${x.kunci ? ' kunci' : ''}`, title: `${x.huruf}: ${x.jumlah} mahasiswa${x.kunci ? ' (kunci)' : ''}` },
            el('b', null, x.huruf), el('i', { style: `height:${totOp ? Math.max(2, 28 * x.jumlah / totOp) : 2}px` }), el('small', null, x.jumlah)))) : null,
          kat.length ? el('div', { class: 'tumpuk', role: 'img', 'aria-label': kat.map((k) => `${KAT_TT[k.kategori] || k.kategori} ${angka(k.persen, 0)}%`).join(', ') },
            kat.map((k) => el('i', { class: `kt-${k.kategori}`, style: `width:${k.persen}%`, title: `${KAT_TT[k.kategori] || k.kategori}: ${angka(k.persen, 0)}%` }))) : null));
    });
    const adaTT = tt.length > 0;
    tambahKe(badan, 
      el('p', { class: 'redup kecil', text: `Berdasarkan ${rekap.filter((r) => r.status === 'selesai').length} mahasiswa yang sudah selesai. Daya beda memakai korelasi skor soal dengan skor total tanpa soal itu. Sebaran jawaban mengikuti huruf asli di lembar soal (sebelum diacak); kunci ditandai gelap.` }),
      adaTT ? el('div', { class: 'legenda-tt' }, Object.entries(KAT_TT).map(([k, t]) => el('span', null, el('i', { class: `kt-${k}` }), t))) : null,
      tabel(['Soal', 'Tipe', { teks: 'N', kelas: 'angka' }, { teks: 'Kesukaran (p)', kelas: 'angka' }, { teks: 'Daya beda', kelas: 'angka' }, 'Sebaran jawaban'], baris, 'tabel-analisis'),
      el('div', { class: 'aksi-baris' },
        tombol('Unduh CSV', () => unduh(`analisis-${u.kode_ujian}.csv`, csv([
          ['Soal', 'Tipe', 'Bacaan', 'N', 'Kesukaran p', 'Kategori', 'Daya beda', 'Keterangan daya beda'],
          ...butir.map((b) => [b.soal_kode, NAMA_TIPE[b.tipe], b.bacaan || '', b.n, String(b.p_kesukaran ?? '').replace('.', ','), b.kategori_kesukaran, String(b.daya_beda ?? '').replace('.', ','), labelDB(b.daya_beda)[0]])
        ]), 'text/csv;charset=utf-8')),
        tombol('Hitung ulang semua nilai', async () => {
          const n = await rpc('hitung_ulang_ujian', { p_ujian_id: id });
          toast(`${n} nilai dihitung ulang`, 'ok'); rute();
        })));
  }

  // ---------- Diagnostik DINA / NPC ----------
  async function tabDiagnostik({ id, u, badan }) {
    const [atribut, qm, resp] = await Promise.all([
      ambil(`atribut?ujian_id=eq.${id}&select=id,kode,nama,urutan&order=urutan`),
      ambil(`v_q_matrix?ujian_id=eq.${id}&select=soal_kode,soal_urutan,atribut_kode,atribut_urutan,nilai`),
      ambil(`v_matriks_respon?ujian_id=eq.${id}&select=sesi_id,nim,nama,soal_id,soal_kode,skor_biner`)
    ]);
    const soalKode = [...new Map(qm.map((q) => [q.soal_kode, q.soal_urutan])).entries()].sort((a, b) => a[1] - b[1]).map(([k]) => k);
    const Q = soalKode.map((k) => atribut.map((a) => (qm.find((q) => q.soal_kode === k && q.atribut_kode === a.kode)?.nilai ? 1 : 0)));
    const soalId = new Map(resp.map((r) => [r.soal_kode, r.soal_id]));
    const mhs = [...new Map(resp.map((r) => [r.sesi_id, { sesi_id: r.sesi_id, nim: r.nim, nama: r.nama }])).values()].sort((a, b) => urutKode(a.nim, b.nim));
    const X = mhs.map((m) => soalKode.map((k) => { const r = resp.find((x) => x.sesi_id === m.sesi_id && x.soal_kode === k); return r ? r.skor_biner : null; }));

    let model = u.model_penilaian === 'npc' ? 'npc' : 'dina';
    const hasilBox = el('div');

    // hasil tersimpan sebelumnya
    let tersimpan = [];
    if (mhs.length) {
      try { tersimpan = await ambil(`hasil_atribut?sesi_id=in.(${mhs.map((m) => m.sesi_id).join(',')})&select=sesi_id,atribut_id,model,peluang,kuasai,dihitung`); } catch { tersimpan = []; }
    }

    const tabelQ = tabel(['Soal', ...atribut.map((a) => ({ teks: a.kode, kelas: 'tengah' }))],
      soalKode.map((k, j) => el('tr', null, el('td', null, k.replace(/^S/, 'Soal ')), Q[j].map((v) => el('td', { class: 'tengah' }, v ? el('span', { class: 'titik-q', 'aria-label': 'diukur' }) : '')))), 'tabel-q');

    function tampilkan(h, sumber) {
      hasilBox.replaceChildren();
      const K = atribut.length;
      const persen = atribut.map((_, k) => h.mahasiswa.filter((m) => m.kuasai[k]).length / h.mahasiswa.length * 100);
      tambahKe(hasilBox, 
        sumber ? el('p', { class: 'info', text: sumber }) : null,
        ...(h.peringatan || []).map((w) => el('p', { class: 'info waspada', text: w })),
        el('section', { class: 'kartu-polos' },
          el('h2', { text: 'Penguasaan atribut di kelas' }),
          atribut.map((a, k) => el('div', { class: 'batang-baris' },
            el('span', null, el('strong', null, a.kode), ` ${a.nama}`),
            el('span', { class: 'batang', role: 'img', 'aria-label': `${angka(persen[k], 0)} persen menguasai` }, el('i', { style: `width:${persen[k]}%` })),
            el('span', { class: 'n', text: `${angka(persen[k], 0)}%` })))),
        el('section', { class: 'kartu-polos' },
          el('h2', { text: 'Profil tiap mahasiswa' }),
          el('p', { class: 'redup kecil', text: h.model === 'dina' ? 'Angka adalah peluang menguasai atribut. Dinyatakan menguasai bila peluang 50% atau lebih.' : 'NPC mengelompokkan mahasiswa ke pola penguasaan yang paling cocok dengan jawabannya.' }),
          tabel(['NIM', 'Nama', ...atribut.map((a) => ({ teks: a.kode, kelas: 'tengah' })), { teks: 'Atribut dikuasai', kelas: 'angka' }],
            h.mahasiswa.map((m, i) => el('tr', null,
              el('td', null, mhs[i].nim), el('td', null, mhs[i].nama),
              atribut.map((_, k) => el('td', { class: `tengah ${m.kuasai[k] ? 'kuasai' : 'belum'}` },
                el('span', { class: 'sel-profil' }, m.kuasai[k] ? 'Ya' : 'Belum'),
                m.peluang ? el('small', { class: 'redup' }, ` ${angka(m.peluang[k] * 100, 0)}%`) : null)),
              el('td', { class: 'angka' }, `${m.kuasai.filter(Boolean).length}/${K}`))), 'tabel-profil')),
        h.slip ? el('section', { class: 'kartu-polos' },
          el('h2', { text: 'Parameter soal (DINA)' }),
          el('p', { class: 'redup kecil', text: 'Slip: peluang salah walau menguasai. Guess: peluang benar walau belum menguasai. Soal dengan 1 − slip − guess di bawah 0,3 kurang mampu membedakan dan sebaiknya ditinjau.' }),
          tabel(['Soal', { teks: 'Slip', kelas: 'angka' }, { teks: 'Guess', kelas: 'angka' }, { teks: '1 − s − g', kelas: 'angka' }, ''],
            soalKode.map((k, j) => { const d = 1 - h.slip[j] - h.guess[j]; return el('tr', null, el('td', null, k.replace(/^S/, 'Soal ')), el('td', { class: 'angka' }, angka(h.slip[j], 3)), el('td', { class: 'angka' }, angka(h.guess[j], 3)), el('td', { class: 'angka' }, angka(d, 2)), el('td', null, d < 0.3 ? chip('Tinjau', 'bahaya') : '')); })),
          el('p', { class: 'redup kecil', text: `Konvergen dalam ${h.iterasi} iterasi. Log-likelihood ${angka(h.logLik, 2)}, AIC ${angka(h.AIC, 1)}, BIC ${angka(h.BIC, 1)}.` })) : null,
        el('div', { class: 'aksi-baris' },
          h.dariServer ? null : tombol('Simpan hasil', async (e) => {
            e.target.disabled = true;
            try {
              const kini = new Date().toISOString();
              await api('POST', 'hasil_atribut', {
                prefer: 'resolution=merge-duplicates,return=minimal',
                body: h.mahasiswa.flatMap((m, i) => atribut.map((a, k) => ({ sesi_id: mhs[i].sesi_id, atribut_id: a.id, model: h.model, peluang: m.peluang ? Number(m.peluang[k].toFixed(4)) : null, kuasai: m.kuasai[k], dihitung: kini })))
              });
              if (h.slip) {
                await api('POST', 'parameter_butir', {
                  prefer: 'resolution=merge-duplicates,return=minimal',
                  body: soalKode.map((k, j) => ({ soal_id: soalId.get(k), model: 'dina', slip: Number(h.slip[j].toFixed(4)), guess: Number(h.guess[j].toFixed(4)), n: X.filter((x) => x[j] != null).length, dihitung: kini })).filter((r) => r.soal_id)
                });
              }
              toast('Hasil diagnostik tersimpan', 'ok');
              e.target.textContent = 'Tersimpan';
            } catch (err) { toast(err.message, 'galat'); e.target.disabled = false; }
          }, 'utama'),
          tombol('Unduh CSV profil', () => unduh(`profil-${u.kode_ujian}.csv`, csv([
            ['NIM', 'Nama', ...atribut.flatMap((a) => (h.mahasiswa[0]?.peluang ? [`${a.kode} ${a.nama}`, `${a.kode} peluang`] : [`${a.kode} ${a.nama}`]))],
            ...h.mahasiswa.map((m, i) => [mhs[i].nim, mhs[i].nama, ...atribut.flatMap((_, k) => (m.peluang ? [m.kuasai[k] ? 'Menguasai' : 'Belum', String(m.peluang[k].toFixed(3)).replace('.', ',')] : [m.kuasai[k] ? 'Menguasai' : 'Belum']))])
          ]), 'text/csv;charset=utf-8'))));
    }

    const jalankan = () => {
      try {
        const h = model === 'dina' ? window.Diagnostik.dina(X, Q) : window.Diagnostik.npc(X, Q);
        tampilkan(h, null);
      } catch (e) { hasilBox.replaceChildren(el('p', { class: 'info waspada', text: e.message })); }
    };

    tambahKe(badan, 
      el('section', { class: 'kartu-polos' },
        el('h2', { text: 'Jalankan analisis' }),
        el('p', { class: 'redup', text: `${mhs.length} mahasiswa selesai, ${soalKode.length} soal, ${atribut.length} atribut. Perhitungan berjalan di browser Anda.` }),
        el('div', { class: 'daftar-saklar' },
          ['dina', 'npc'].map((v) => el('label', { class: 'saklar' },
            el('input', { type: 'radio', name: 'model-diag', checked: model === v, onchange: () => { model = v; } }),
            el('span', null, v === 'dina' ? 'DINA (estimasi EM): paling tepat untuk ratusan peserta' : 'NPC (nonparametrik): stabil untuk satu kelas')))),
        el('div', { class: 'aksi-baris' }, tombol('Jalankan analisis', jalankan, 'utama', { disabled: !mhs.length || null }))),
      el('details', { class: 'kartu-polos' }, el('summary', null, 'Lihat Q-matrix'), tabelQ),
      hasilBox);

    if (!mhs.length) tambahKe(hasilBox, kosong('Belum ada mahasiswa yang selesai. Analisis bisa dijalankan setelah ada data.'));
    else if (tersimpan.length) {
      const modelSimpan = tersimpan[0].model;
      const h = {
        model: modelSimpan, dariServer: true, peringatan: [],
        mahasiswa: mhs.map((m) => {
          const r = atribut.map((a) => tersimpan.find((t) => t.sesi_id === m.sesi_id && t.atribut_id === a.id));
          return { kuasai: r.map((x) => !!x?.kuasai), peluang: r.every((x) => x?.peluang != null) ? r.map((x) => Number(x.peluang)) : null };
        })
      };
      const terakhir = tersimpan.reduce((t, x) => (x.dihitung > t ? x.dihitung : t), '');
      tampilkan(h, `Menampilkan hasil ${modelSimpan.toUpperCase()} yang tersimpan pada ${tanggal(terakhir)}. Jalankan analisis lagi bila ada mahasiswa baru.`);
    }
  }

  // =========================================================
  // MULAI
  // =========================================================
  $('#tombol-keluar').addEventListener('click', () => Auth.keluar());
  window.addEventListener('hashchange', rute);
  if (!CFG.SUPABASE_URL || CFG.SUPABASE_URL.includes('xxxx')) {
    isi.replaceChildren(el('div', { class: 'halaman' }, el('h1', { text: 'Supabase belum diatur' }), el('p', { class: 'info waspada', text: 'Isi SUPABASE_URL dan SUPABASE_ANON_KEY di file config.js, lalu muat ulang halaman ini.' })));
  } else {
    rute();
  }
})();
