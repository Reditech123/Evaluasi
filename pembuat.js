/* =========================================================
   Pembuat ujian berbasis formulir.
   Dosen memilih metode ujian dan tipe tiap soal dari menu; kolom isian
   menyesuaikan tipe. Hasil akhirnya JSON yang sama dengan format impor,
   lalu dikirim ke fungsi impor_ujian / ganti_ujian di server.
   ========================================================= */
(function () {
  'use strict';
  const { el, $, $$, huruf, idAcak, lokal } = window.U;

  const SEMUA_TIPE = ['pg', 'pg_kompleks', 'benar_salah', 'menjodohkan', 'isian_singkat', 'three_tier', 'uraian'];
  const TIPE = {
    pg: 'Pilihan ganda',
    pg_kompleks: 'Pilihan ganda kompleks',
    benar_salah: 'Benar–salah',
    menjodohkan: 'Menjodohkan',
    isian_singkat: 'Isian singkat',
    three_tier: 'Three-tier',
    uraian: 'Uraian'
  };
  const METODE = [
    { nilai: 'pg', nama: 'Pilihan ganda', ket: 'Soal lepas dengan satu jawaban benar.', tipe: ['pg'] },
    { nilai: 'literasi', nama: 'Literasi', ket: 'Bacaan diikuti beberapa soal, seperti TOEFL Reading dan AKM.', tipe: ['pg', 'pg_kompleks', 'benar_salah', 'menjodohkan', 'isian_singkat'] },
    { nilai: 'three_tier', nama: 'Three-tier', ket: 'Jawaban, alasan, dan keyakinan untuk mendeteksi miskonsepsi.', tipe: ['three_tier'] },
    { nilai: 'dina', nama: 'Diagnostik', ket: 'Soal ditandai atribut kognitif; hasilnya profil penguasaan tiap mahasiswa (DINA/NPC).', tipe: ['pg', 'pg_kompleks', 'benar_salah', 'menjodohkan', 'isian_singkat', 'three_tier'] },
    { nilai: 'kustom', nama: 'Campuran', ket: 'Bebas mencampur semua tipe soal, termasuk uraian.', tipe: SEMUA_TIPE }
  ];
  const metodeDari = (p) => METODE.find((m) => m.nilai === p) || METODE[0];
  const PENGATURAN_AWAL = {
    durasi_menit: 60, acak_urutan: true, acak_dalam_bacaan: false, acak_opsi: true,
    maks_pindah_tab: 3, izinkan_lanjut: true, tampilkan_skor: true, tampilkan_pembahasan: false,
    skala_nilai: 100, waktu_mulai: null, waktu_selesai: null
  };

  // ---------- konversi indeks ----------
  function keIndeks(v) {
    if (typeof v === 'number') return v;
    if (typeof v === 'string' && /^[A-Za-z]$/.test(v)) return v.toUpperCase().charCodeAt(0) - 65;
    if (typeof v === 'string' && /^\d+$/.test(v)) return Number(v);
    return null;
  }
  const teksDari = (o) => (o == null ? '' : typeof o === 'object' ? (o.teks ?? '') : String(o));

  function tabelKeTeks(t) {
    if (!t || !Array.isArray(t.baris)) return '';
    const b = [];
    if (Array.isArray(t.kolom)) b.push(t.kolom.join(' | '));
    t.baris.forEach((r) => b.push(r.join(' | ')));
    return b.join('\n');
  }
  function teksKeTabel(s) {
    const b = String(s || '').split('\n').map((x) => x.trim()).filter(Boolean).map((x) => x.split('|').map((c) => c.trim()));
    if (b.length < 2) return null;
    return { kolom: b[0], baris: b.slice(1) };
  }
  const isiOpsi = (arr) => arr.map((x, i) => [String(x || '').trim(), i]).filter(([t]) => t);

  // ---------- soal baru ----------
  function soalBaru(tipe, paket, lama) {
    const s = {
      _id: idAcak(), tipe,
      stimulus: lama?.stimulus || '', bobot: lama?.bobot ?? 1, opsi_tetap: lama?.opsi_tetap || false,
      pertanyaan: lama?.pertanyaan || '', pembahasan: lama?.pembahasan || '',
      atribut: lama?.atribut ? [...lama.atribut] : [], paket: lama?.paket ? [...lama.paket] : [...paket]
    };
    const opsiLama = lama && Array.isArray(lama.opsi) ? [...lama.opsi] : ['', '', '', ''];
    switch (tipe) {
      case 'pg': Object.assign(s, { opsi: opsiLama, kunci: lama?.kunci ?? null }); break;
      case 'pg_kompleks': Object.assign(s, { opsi: opsiLama, kunciBanyak: lama?.kunciBanyak || (lama?.kunci != null ? [lama.kunci] : []), parsial: true }); break;
      case 'benar_salah': Object.assign(s, { pernyataan: [0, 1, 2].map(() => ({ teks: '', benar: null })), penilaianParsial: true }); break;
      case 'menjodohkan': Object.assign(s, { pasangan: [0, 1, 2].map(() => ({ kiri: '', kanan: '' })), pengecoh: [] }); break;
      case 'isian_singkat': Object.assign(s, { jawaban: '', numerik: false, nilai: '', toleransi: '', satuan: '' }); break;
      case 'three_tier': Object.assign(s, { opsi: opsiLama, kunci: lama?.kunci ?? null, alasan: lama?.alasan ? [...lama.alasan] : ['', '', '', ''], kunciAlasan: lama?.kunciAlasan ?? null, keyakinan: ['Yakin', 'Tidak yakin'] }); break;
      case 'uraian': Object.assign(s, { maks_kata: '', rubrik: [{ kriteria: '', skor: '' }] }); break;
    }
    return s;
  }

  // ---------- JSON impor -> keadaan formulir ----------
  function dariJSON(d) {
    d = d || {};
    const u = d.ujian || {};
    const stimulus = (d.stimulus || []).map((s) => ({
      _id: idAcak(), kodeLama: s.kode, judul: s.judul || '', jenis: s.jenis || 'teks',
      paragraf: (s.paragraf || []).join('\n\n'), tabel: tabelKeTeks(s.tabel),
      gambar: (s.gambar || []).map((g) => ({ url: g.url || '', keterangan: g.keterangan || '' })),
      sumber: s.sumber || ''
    }));
    const atribut = (d.atribut || []).map((a) => ({ _id: idAcak(), kodeLama: a.kode, nama: a.nama || '', deskripsi: a.deskripsi || '' }));
    const paket = (d.paket || []).length ? d.paket.map((p) => p.nama) : ['A'];

    const soal = (d.soal || []).map((x, i) => {
      const tipe = SEMUA_TIPE.includes(x.tipe) ? x.tipe : 'pg';
      let k = x.kunci;
      if (k == null) k = {};
      else if (typeof k !== 'object' || Array.isArray(k)) k = { jawaban: k };
      const kodeSoal = x.kode || `S${i + 1}`;
      const s = soalBaru(tipe, paket);
      s.pertanyaan = x.pertanyaan || '';
      s.pembahasan = x.pembahasan || '';
      s.bobot = x.bobot ?? 1;
      s.opsi_tetap = !!x.opsi_tetap;
      s.stimulus = stimulus.find((t) => t.kodeLama === x.stimulus)?._id || '';
      if (Array.isArray(x.atribut)) s.atribut = x.atribut.map((kd) => atribut.find((a) => a.kodeLama === kd)?._id).filter(Boolean);
      else if (Array.isArray(x.q_matrix)) s.atribut = x.q_matrix.map((v, j) => (Number(v) === 1 ? atribut[j]?._id : null)).filter(Boolean);
      if ((d.paket || []).length) s.paket = d.paket.filter((p) => (p.soal || []).includes(kodeSoal)).map((p) => p.nama);

      switch (tipe) {
        case 'pg':
          s.opsi = (x.opsi || []).map(teksDari); s.kunci = keIndeks(k.jawaban); break;
        case 'pg_kompleks':
          s.opsi = (x.opsi || []).map(teksDari); s.kunciBanyak = (k.jawaban || []).map(keIndeks).filter((v) => v != null);
          s.parsial = k.penilaian !== 'semua_atau_nol'; break;
        case 'benar_salah':
          s.pernyataan = (x.pernyataan || []).map((p, j) => ({ teks: teksDari(p), benar: Array.isArray(k.jawaban) ? k.jawaban[j] ?? null : null }));
          s.penilaianParsial = k.penilaian !== 'semua_atau_nol'; break;
        case 'menjodohkan': {
          const kanan = (x.kanan || []).map(teksDari);
          const kj = (k.jawaban || []).map(keIndeks);
          s.pasangan = (x.kiri || []).map((kr, j) => ({ kiri: teksDari(kr), kanan: kanan[kj[j]] ?? '' }));
          s.pengecoh = kanan.filter((_, j) => !kj.includes(j));
          break;
        }
        case 'isian_singkat':
          s.jawaban = (Array.isArray(k.jawaban) ? k.jawaban : k.jawaban != null ? [k.jawaban] : []).join('\n');
          s.numerik = !!k.numerik; s.nilai = k.numerik?.nilai ?? ''; s.toleransi = k.numerik?.toleransi ?? '';
          s.satuan = x.satuan || ''; break;
        case 'three_tier':
          s.opsi = (x.opsi || []).map(teksDari); s.alasan = (x.alasan || []).map(teksDari);
          s.kunci = keIndeks(k.jawaban); s.kunciAlasan = keIndeks(k.alasan);
          s.keyakinan = Array.isArray(x.keyakinan) && x.keyakinan.length === 2 ? x.keyakinan.map(String) : ['Yakin', 'Tidak yakin'];
          s.skorDuaTingkat = k.skor === 'dua_tingkat'; break;
        case 'uraian':
          s.maks_kata = x.maks_kata ?? '';
          s.rubrik = Array.isArray(k.rubrik) && k.rubrik.length ? k.rubrik.map((r) => ({ kriteria: r.kriteria || '', skor: r.skor ?? '' })) : [{ kriteria: '', skor: k.skor_maks ?? '' }];
          break;
      }
      return s;
    });

    return {
      ujian: {
        judul: u.judul || '', mata_kuliah: u.mata_kuliah || '', kode_ujian: u.kode_ujian || '',
        preset: METODE.some((m) => m.nilai === u.preset) ? u.preset : 'pg',
        model_penilaian: u.model_penilaian === 'npc' ? 'npc' : (u.model_penilaian || ''),
        status: u.status || 'draf',
        pengaturan: { ...PENGATURAN_AWAL, ...(u.pengaturan || {}) }
      },
      stimulus, atribut, paket, soal
    };
  }

  // ---------- keadaan formulir -> JSON impor ----------
  function modelDari(U) {
    if (U.ujian.preset === 'dina') return U.ujian.model_penilaian === 'npc' ? 'npc' : 'dina';
    if (U.ujian.preset === 'three_tier') return 'three_tier';
    return 'klasik';
  }

  function keJSON(U) {
    const kodeStim = new Map(U.stimulus.map((s, i) => [s._id, `B${i + 1}`]));
    const kodeAtr = new Map(U.atribut.map((a, i) => [a._id, `A${i + 1}`]));
    const model = modelDari(U);
    const diagnostik = model === 'dina' || model === 'npc';
    const p = U.ujian.pengaturan;
    const pengaturan = {
      ...p,
      durasi_menit: Number(p.durasi_menit) || 60,
      maks_pindah_tab: Number(p.maks_pindah_tab) || 0,
      skala_nilai: Number(p.skala_nilai) || 100,
      waktu_mulai: p.waktu_mulai ? new Date(p.waktu_mulai).toISOString() : null,
      waktu_selesai: p.waktu_selesai ? new Date(p.waktu_selesai).toISOString() : null
    };

    const soal = U.soal.map((s, i) => {
      const o = { kode: `S${i + 1}`, tipe: s.tipe, pertanyaan: s.pertanyaan.trim(), bobot: Number(s.bobot) > 0 ? Number(s.bobot) : 1 };
      if (s.stimulus && kodeStim.has(s.stimulus)) o.stimulus = kodeStim.get(s.stimulus);
      if (s.opsi_tetap) o.opsi_tetap = true;
      if (s.pembahasan.trim()) o.pembahasan = s.pembahasan.trim();
      if (diagnostik) o.atribut = s.atribut.filter((a) => kodeAtr.has(a)).map((a) => kodeAtr.get(a));

      switch (s.tipe) {
        case 'pg': {
          const isi = isiOpsi(s.opsi);
          o.opsi = isi.map(([t]) => t);
          o.kunci = isi.findIndex(([, j]) => j === s.kunci);
          break;
        }
        case 'pg_kompleks': {
          const isi = isiOpsi(s.opsi);
          o.opsi = isi.map(([t]) => t);
          o.kunci = { jawaban: isi.map(([, j], b) => (s.kunciBanyak.includes(j) ? b : -1)).filter((b) => b >= 0), penilaian: s.parsial ? 'parsial' : 'semua_atau_nol' };
          break;
        }
        case 'benar_salah': {
          const isi = s.pernyataan.filter((p) => p.teks.trim());
          o.pernyataan = isi.map((p) => p.teks.trim());
          o.kunci = { jawaban: isi.map((p) => p.benar), penilaian: s.penilaianParsial === false ? 'semua_atau_nol' : 'parsial' };
          break;
        }
        case 'menjodohkan': {
          const pas = s.pasangan.filter((p) => p.kiri.trim() || p.kanan.trim());
          const kanan = [];
          const idx = (t) => { const v = t.trim(); let j = kanan.indexOf(v); if (j < 0) { kanan.push(v); j = kanan.length - 1; } return j; };
          const kunci = pas.map((p) => idx(p.kanan));
          s.pengecoh.map((x) => x.trim()).filter(Boolean).forEach(idx);
          o.kiri = pas.map((p) => p.kiri.trim());
          o.kanan = kanan;
          o.kunci = kunci;
          break;
        }
        case 'isian_singkat': {
          const daftar = s.jawaban.split('\n').map((x) => x.trim()).filter(Boolean);
          o.kunci = { jawaban: daftar };
          if (s.numerik && String(s.nilai).trim() !== '') {
            o.kunci.numerik = { nilai: Number(String(s.nilai).replace(',', '.')), toleransi: Number(String(s.toleransi || 0).replace(',', '.')) || 0 };
          }
          if (s.satuan.trim()) o.satuan = s.satuan.trim();
          break;
        }
        case 'three_tier': {
          const isi = isiOpsi(s.opsi), al = isiOpsi(s.alasan);
          o.opsi = isi.map(([t]) => t);
          o.alasan = al.map(([t]) => t);
          o.keyakinan = s.keyakinan.map((x, j) => x.trim() || ['Yakin', 'Tidak yakin'][j]);
          o.kunci = { jawaban: isi.findIndex(([, j]) => j === s.kunci), alasan: al.findIndex(([, j]) => j === s.kunciAlasan) };
          if (s.skorDuaTingkat) o.kunci.skor = 'dua_tingkat';
          break;
        }
        case 'uraian': {
          if (Number(s.maks_kata) > 0) o.maks_kata = Number(s.maks_kata);
          const rub = s.rubrik.filter((r) => r.kriteria.trim() || Number(r.skor) > 0).map((r) => ({ kriteria: r.kriteria.trim(), skor: Number(r.skor) || 0 }));
          const maks = rub.reduce((t, r) => t + r.skor, 0);
          o.kunci = maks > 0 ? { skor_maks: maks, rubrik: rub } : {};
          break;
        }
      }
      return o;
    });

    const json = {
      ujian: {
        judul: U.ujian.judul.trim(), mata_kuliah: U.ujian.mata_kuliah.trim() || null,
        kode_ujian: U.ujian.kode_ujian.trim().toUpperCase() || null,
        preset: U.ujian.preset, model_penilaian: model, status: U.ujian.status || 'draf', pengaturan
      },
      stimulus: U.stimulus.map((s) => {
        const o = { kode: kodeStim.get(s._id), judul: s.judul.trim() || null, jenis: s.jenis, paragraf: s.paragraf.split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean) };
        const t = teksKeTabel(s.tabel); if (t) o.tabel = t;
        const g = s.gambar.filter((x) => x.url.trim()); if (g.length) o.gambar = g.map((x) => ({ url: x.url.trim(), keterangan: x.keterangan.trim() }));
        if (s.sumber.trim()) o.sumber = s.sumber.trim();
        return o;
      }),
      soal,
      paket: U.paket.map((nama) => ({ nama, soal: U.soal.map((s, i) => (s.paket.includes(nama) ? `S${i + 1}` : null)).filter(Boolean) }))
    };
    if (model === 'dina' || model === 'npc') json.atribut = U.atribut.map((a) => ({ kode: kodeAtr.get(a._id), nama: a.nama.trim(), deskripsi: a.deskripsi.trim() || null }));
    return json;
  }

  // ---------- validasi di browser (server tetap memeriksa ulang) ----------
  function validasi(U) {
    const galat = [], waspada = [];
    const tambah = (daftar, pesan, target) => daftar.push({ pesan, target });
    const metode = metodeDari(U.ujian.preset);
    const diagnostik = U.ujian.preset === 'dina';

    if (!U.ujian.judul.trim()) tambah(galat, 'Isi judul ujian.', 'bagian-info');
    if (U.ujian.kode_ujian.trim() && !/^[A-Za-z0-9-]{3,20}$/.test(U.ujian.kode_ujian.trim())) tambah(galat, 'Kode ujian hanya boleh huruf, angka, atau tanda hubung (3–20 karakter).', 'bagian-info');
    if (!U.soal.length) tambah(galat, 'Tambahkan minimal satu soal.', 'bagian-soal');
    if (diagnostik) {
      if (!U.atribut.length) tambah(galat, 'Metode diagnostik membutuhkan minimal satu atribut.', 'bagian-atribut');
      U.atribut.forEach((a, i) => {
        if (!a.nama.trim()) tambah(galat, `Atribut A${i + 1}: isi nama atribut.`, 'bagian-atribut');
        if (!U.soal.some((s) => s.atribut.includes(a._id))) tambah(galat, `Atribut A${i + 1} belum diukur oleh soal mana pun.`, 'bagian-atribut');
      });
    }
    U.paket.forEach((p) => { if (U.soal.length && !U.soal.some((s) => s.paket.includes(p))) tambah(galat, `Paket ${p} belum berisi soal.`, 'bagian-paket'); });

    U.soal.forEach((s, i) => {
      const n = `Soal ${i + 1}`, t = `soal-${s._id}`;
      if (!metode.tipe.includes(s.tipe)) tambah(galat, `${n}: tipe ${TIPE[s.tipe]} tidak tersedia untuk metode ${metode.nama}. Ganti tipenya atau pilih metode Campuran.`, t);
      if (!s.pertanyaan.trim()) tambah(galat, `${n}: isi pertanyaan.`, t);
      if (U.paket.length > 1 && !s.paket.length) tambah(galat, `${n}: pilih minimal satu paket.`, t);
      if (diagnostik && !s.atribut.length) tambah(galat, `${n}: tandai atribut yang diukur.`, t);
      if (U.ujian.preset === 'literasi' && !s.stimulus) tambah(waspada, `${n} tidak terhubung ke bacaan; akan tampil sebagai soal lepas.`, t);
      const isi = (arr) => isiOpsi(arr || []);
      switch (s.tipe) {
        case 'pg':
          if (isi(s.opsi).length < 2) tambah(galat, `${n}: isi minimal dua pilihan jawaban.`, t);
          else if (!isi(s.opsi).some(([, j]) => j === s.kunci)) tambah(galat, `${n}: tandai kunci jawaban (klik hurufnya).`, t);
          break;
        case 'pg_kompleks':
          if (isi(s.opsi).length < 2) tambah(galat, `${n}: isi minimal dua pilihan jawaban.`, t);
          else if (!isi(s.opsi).some(([, j]) => s.kunciBanyak.includes(j))) tambah(galat, `${n}: tandai minimal satu kunci jawaban.`, t);
          break;
        case 'benar_salah': {
          const p = s.pernyataan.filter((x) => x.teks.trim());
          if (!p.length) tambah(galat, `${n}: isi minimal satu pernyataan.`, t);
          else if (p.some((x) => typeof x.benar !== 'boolean')) tambah(galat, `${n}: tentukan Benar atau Salah untuk setiap pernyataan.`, t);
          break;
        }
        case 'menjodohkan': {
          const p = s.pasangan.filter((x) => x.kiri.trim() || x.kanan.trim());
          if (p.length < 2) tambah(galat, `${n}: isi minimal dua pasangan.`, t);
          else if (p.some((x) => !x.kiri.trim() || !x.kanan.trim())) tambah(galat, `${n}: setiap pasangan harus terisi di kedua sisi.`, t);
          break;
        }
        case 'isian_singkat':
          if (!s.jawaban.trim() && !(s.numerik && String(s.nilai).trim() !== '')) tambah(galat, `${n}: isi minimal satu jawaban yang diterima.`, t);
          if (s.numerik && String(s.nilai).trim() !== '' && Number.isNaN(Number(String(s.nilai).replace(',', '.')))) tambah(galat, `${n}: nilai angka tidak valid.`, t);
          break;
        case 'three_tier':
          if (isi(s.opsi).length < 2) tambah(galat, `${n}: isi minimal dua pilihan jawaban (bagian 1).`, t);
          else if (!isi(s.opsi).some(([, j]) => j === s.kunci)) tambah(galat, `${n}: tandai kunci jawaban di bagian 1.`, t);
          if (isi(s.alasan).length < 2) tambah(galat, `${n}: isi minimal dua pilihan alasan (bagian 2).`, t);
          else if (!isi(s.alasan).some(([, j]) => j === s.kunciAlasan)) tambah(galat, `${n}: tandai alasan yang benar di bagian 2.`, t);
          break;
        case 'uraian':
          if (!s.rubrik.some((r) => Number(r.skor) > 0)) tambah(waspada, `${n}: rubrik belum diisi; skor uraian akan memakai skala 0 sampai bobot soal.`, t);
          break;
      }
    });
    return { galat, waspada };
  }

  // =========================================================
  // TAMPILAN FORMULIR
  // =========================================================
  function buka(wadah, opsi) {
    const kunciDraf = opsi.kunciDraf || 'cbt_draf_baru';
    let U = dariJSON(opsi.data || { ujian: { preset: 'pg' }, soal: [] });
    if (!opsi.data) U.soal.push(soalBaru('pg', U.paket));
    let jedaDraf;
    const simpanDraf = () => {
      clearTimeout(jedaDraf);
      jedaDraf = setTimeout(() => lokal.taruh(kunciDraf, { waktu: Date.now(), U }), 500);
    };

    // ---- komponen kecil ----
    const masukan = (obj, kunci, attrs = {}) => {
      const tag = attrs.baris ? 'textarea' : 'input';
      const { baris, segarkan, ...lain } = attrs;
      const n = el(tag, { ...lain, rows: baris || null, value: obj[kunci] ?? '', oninput: (e) => { obj[kunci] = e.target.value; simpanDraf(); if (segarkan) segarkanRingan(); } });
      return n;
    };
    const kolom = (label, kontrol, petunjuk) => el('label', { class: 'kolom' }, el('span', { class: 'label' }, label), kontrol, petunjuk ? el('span', { class: 'petunjuk-kolom' }, petunjuk) : null);
    const saklar = (obj, kunci, label, ubah) => el('label', { class: 'saklar' },
      el('input', { type: 'checkbox', checked: !!obj[kunci], onchange: (e) => { obj[kunci] = e.target.checked; simpanDraf(); if (ubah) ubah(); } }),
      el('span', null, label));
    const tombol = (teks, aksi, kelas = 'garis kecil', attrs = {}) => el('button', { type: 'button', class: `tombol ${kelas}`, onclick: aksi, ...attrs }, teks);
    const bagian = (id, judul, ket, ...isi) => el('section', { class: 'bagian-form', id }, el('div', { class: 'bagian-kepala' }, el('h2', { text: judul }), ket ? el('p', { class: 'redup', text: ket }) : null), ...isi);

    function render() {
      const y = window.scrollY;
      wadah.replaceChildren(...[
        renderKepala(), renderDraf(), el('div', { id: 'panel-validasi' }),
        renderInfo(), renderMetode(), renderPengaturan(),
        U.ujian.preset === 'dina' ? renderAtribut() : null,
        renderBacaan(), renderPaket(), renderSoal(), renderKaki()].filter(Boolean));
      window.scrollTo(0, y);
    }
    function segarkanRingan() {
      // perbarui label yang bergantung pada teks tanpa merender ulang seluruh form
      $$('[data-label-bacaan]', wadah).forEach((sel) => {
        const nilai = sel.value;
        sel.replaceChildren(...opsiBacaan(nilai));
      });
    }

    function renderKepala() {
      return el('div', { class: 'kepala-form' },
        el('div', null,
          el('a', { href: opsi.kembali || '#/', class: 'tautan-kembali' }, 'Kembali'),
          el('h1', { text: opsi.mode === 'ganti' ? 'Ubah ujian' : 'Buat ujian' })),
        el('div', { class: 'aksi-kepala' },
          tombol('Unduh JSON', () => {
            const j = keJSON(U);
            window.U.unduh(`${(j.ujian.kode_ujian || j.ujian.judul || 'ujian').replace(/[^\w-]+/g, '_')}.json`, JSON.stringify(j, null, 2), 'application/json');
          }, 'garis'),
          tombol(opsi.mode === 'ganti' ? 'Simpan perubahan' : 'Simpan ujian', simpan, 'utama', { id: 'tombol-simpan-ujian' })));
    }

    function renderDraf() {
      const d = lokal.ambil(kunciDraf);
      if (!d || !d.U || opsi.drafDipakai) return null;
      const box = el('div', { class: 'info-bar' },
        el('span', null, `Ada draf yang belum disimpan dari ${window.U.tanggal(d.waktu)}.`),
        tombol('Lanjutkan draf', () => { U = d.U; opsi.drafDipakai = true; render(); }),
        tombol('Buang draf', () => { lokal.hapus(kunciDraf); opsi.drafDipakai = true; box.remove(); }));
      return box;
    }

    function renderInfo() {
      return bagian('bagian-info', 'Informasi ujian', null,
        el('div', { class: 'grid-2' },
          kolom('Judul ujian', masukan(U.ujian, 'judul', { required: true, placeholder: 'mis. UTS Konsep Dasar IPA Fisika' })),
          kolom('Mata kuliah', masukan(U.ujian, 'mata_kuliah'))),
        el('div', { class: 'grid-2' },
          kolom('Kode ujian', masukan(U.ujian, 'kode_ujian', { placeholder: 'Kosongkan untuk dibuat otomatis', disabled: opsi.mode === 'ganti', autocapitalize: 'characters' }),
            opsi.mode === 'ganti' ? 'Kode ujian tidak berubah saat soal diubah.' : 'Kode ini yang dimasukkan mahasiswa untuk ikut ujian.')));
    }

    function renderMetode() {
      const pil = el('div', { class: 'pilihan-metode', role: 'radiogroup', 'aria-label': 'Metode ujian' },
        METODE.map((m) => el('label', { class: 'kartu-metode' },
          el('input', { type: 'radio', name: 'metode', value: m.nilai, checked: U.ujian.preset === m.nilai, onchange: () => gantiMetode(m.nilai) }),
          el('strong', { text: m.nama }), el('span', { class: 'redup', text: m.ket }),
          el('span', { class: 'tipe-izin', text: m.tipe.length === SEMUA_TIPE.length ? 'Semua tipe soal' : m.tipe.map((t) => TIPE[t]).join(', ') }))));
      const model = U.ujian.preset === 'dina' ? el('div', { class: 'pilih-model' },
        el('span', { class: 'label' }, 'Cara menghitung profil'),
        ['dina', 'npc'].map((v) => el('label', { class: 'saklar' },
          el('input', { type: 'radio', name: 'model', checked: (U.ujian.model_penilaian === 'npc' ? 'npc' : 'dina') === v, onchange: () => { U.ujian.model_penilaian = v; simpanDraf(); } }),
          el('span', null, v === 'dina' ? 'DINA: estimasi statistik, terbaik untuk peserta banyak' : 'NPC: klasifikasi tanpa estimasi, cocok untuk satu kelas')))) : null;
      return bagian('bagian-metode', 'Metode ujian', 'Metode menentukan tipe soal yang tersedia dan cara hasil diolah.', pil, model);
    }

    function gantiMetode(m) {
      U.ujian.preset = m;
      const izin = metodeDari(m).tipe;
      // soal kosong yang tipenya tidak diizinkan diganti otomatis
      U.soal = U.soal.map((s) => (izin.includes(s.tipe) || s.pertanyaan.trim() ? s : soalBaru(izin[0], U.paket, s)));
      if (m === 'literasi' && !U.stimulus.length) U.stimulus.push(bacaanBaru());
      if (m === 'dina' && !U.atribut.length) U.atribut.push({ _id: idAcak(), nama: '', deskripsi: '' });
      simpanDraf();
      render();
    }

    function renderPengaturan() {
      const p = U.ujian.pengaturan;
      const waktu = (k) => el('input', {
        type: 'datetime-local', value: p[k] ? toLokal(p[k]) : '',
        onchange: (e) => { p[k] = e.target.value || null; simpanDraf(); }
      });
      return bagian('bagian-pengaturan', 'Pengaturan', null,
        el('div', { class: 'grid-3' },
          kolom('Durasi (menit)', masukan(p, 'durasi_menit', { type: 'number', min: 1, inputmode: 'numeric' })),
          kolom('Batas pindah tab', masukan(p, 'maks_pindah_tab', { type: 'number', min: 0, inputmode: 'numeric' }), 'Isi 0 untuk tidak membatasi.'),
          kolom('Skala nilai', masukan(p, 'skala_nilai', { type: 'number', min: 1, inputmode: 'numeric' }))),
        el('div', { class: 'grid-2' },
          kolom('Dibuka mulai (opsional)', waktu('waktu_mulai')),
          kolom('Ditutup pada (opsional)', waktu('waktu_selesai'))),
        el('div', { class: 'daftar-saklar' },
          saklar(p, 'acak_urutan', 'Acak urutan soal dan bacaan'),
          saklar(p, 'acak_dalam_bacaan', 'Acak urutan soal di dalam satu bacaan'),
          saklar(p, 'acak_opsi', 'Acak urutan pilihan jawaban'),
          saklar(p, 'izinkan_lanjut', 'Mahasiswa yang terputus boleh masuk lagi dan melanjutkan'),
          saklar(p, 'tampilkan_skor', 'Tampilkan nilai setelah mahasiswa selesai'),
          saklar(p, 'tampilkan_pembahasan', 'Tampilkan kunci dan pembahasan setelah ujian ditutup')));
    }

    // ---- atribut ----
    function renderAtribut() {
      const daftar = el('div', { class: 'daftar-baris' }, U.atribut.map((a, i) => el('div', { class: 'baris-atribut' },
        el('span', { class: 'kode-atribut', text: `A${i + 1}` }),
        masukan(a, 'nama', { placeholder: 'Nama atribut, mis. Menyamakan penyebut', 'aria-label': `Nama atribut A${i + 1}` }),
        masukan(a, 'deskripsi', { placeholder: 'Deskripsi (opsional)', 'aria-label': `Deskripsi atribut A${i + 1}` }),
        tombol('Hapus', () => { U.atribut.splice(i, 1); U.soal.forEach((s) => { s.atribut = s.atribut.filter((x) => x !== a._id); }); simpanDraf(); render(); }, 'garis kecil', { disabled: U.atribut.length === 1 }))));
      return bagian('bagian-atribut', 'Atribut kognitif', 'Keterampilan yang ingin didiagnosis. Disarankan 3–6 atribut, dan setiap atribut punya minimal satu soal yang hanya mengukur atribut itu.',
        daftar, tombol('Tambah atribut', () => { U.atribut.push({ _id: idAcak(), nama: '', deskripsi: '' }); simpanDraf(); render(); }, 'garis', { disabled: U.atribut.length >= 8 }));
    }

    // ---- bacaan ----
    function bacaanBaru() { return { _id: idAcak(), judul: '', jenis: 'teks', paragraf: '', tabel: '', gambar: [], sumber: '' }; }
    function namaBacaan(s, i) { return `Bacaan ${i + 1}${s.judul.trim() ? ': ' + s.judul.trim() : ''}`; }
    function opsiBacaan(terpilih) {
      return [el('option', { value: '', text: 'Tanpa bacaan (soal lepas)' }),
        ...U.stimulus.map((s, i) => el('option', { value: s._id, selected: s._id === terpilih, text: namaBacaan(s, i) }))];
    }

    function renderBacaan() {
      const kartu = U.stimulus.map((s, i) => {
        const jumlah = U.soal.filter((x) => x.stimulus === s._id).length;
        return el('article', { class: 'kartu-bacaan', id: `bacaan-${s._id}` },
          el('div', { class: 'kartu-kepala' },
            el('strong', { text: `Bacaan ${i + 1}` }),
            el('span', { class: 'redup', text: jumlah ? `${jumlah} soal` : 'Belum ada soal' }),
            el('div', { class: 'aksi-kartu' },
              tombol('Tambah soal untuk bacaan ini', () => tambahSoal(null, s._id)),
              tombol('Hapus', () => {
                if (jumlah && !confirm(`Bacaan ${i + 1} dipakai ${jumlah} soal. Soal-soal itu akan menjadi soal lepas. Hapus bacaan?`)) return;
                U.stimulus.splice(i, 1); U.soal.forEach((x) => { if (x.stimulus === s._id) x.stimulus = ''; }); simpanDraf(); render();
              }))),
          el('div', { class: 'grid-2' },
            kolom('Judul bacaan', masukan(s, 'judul', { segarkan: true })),
            kolom('Jenis', el('select', { onchange: (e) => { s.jenis = e.target.value; simpanDraf(); } },
              [['teks', 'Teks'], ['tabel', 'Tabel'], ['gambar', 'Gambar'], ['kasus', 'Kasus'], ['campuran', 'Campuran']].map(([v, t]) => el('option', { value: v, selected: s.jenis === v, text: t }))))),
          kolom('Isi bacaan', masukan(s, 'paragraf', { baris: 8, class: 'teks-bacaan' }), 'Pisahkan paragraf dengan satu baris kosong. Paragraf diberi nomor otomatis (¶1, ¶2, …).'),
          el('details', { class: 'tambahan', open: !!(s.tabel || s.gambar.length || s.sumber) || null },
            el('summary', null, 'Tabel, gambar, dan sumber'),
            kolom('Tabel (opsional)', masukan(s, 'tabel', { baris: 4, placeholder: 'Hari | Kegiatan | Tempat\nSenin | Membaca senyap | Kelas' }), 'Baris pertama berisi judul kolom. Pisahkan kolom dengan tanda |.'),
            el('div', { class: 'daftar-baris' }, s.gambar.map((g, j) => el('div', { class: 'baris-gambar' },
              masukan(g, 'url', { placeholder: 'Alamat gambar (https://…)', 'aria-label': 'Alamat gambar' }),
              masukan(g, 'keterangan', { placeholder: 'Keterangan gambar', 'aria-label': 'Keterangan gambar' }),
              tombol('Hapus', () => { s.gambar.splice(j, 1); simpanDraf(); render(); })))),
            tombol('Tambah gambar', () => { s.gambar.push({ url: '', keterangan: '' }); simpanDraf(); render(); }),
            kolom('Sumber (opsional)', masukan(s, 'sumber'))));
      });
      return bagian('bagian-bacaan', 'Bacaan', U.ujian.preset === 'literasi'
        ? 'Setiap bacaan bisa dipakai untuk beberapa soal. Mahasiswa melihat bacaan di kiri dan soal di kanan.'
        : 'Opsional. Tambahkan bacaan, tabel, atau kasus bila beberapa soal merujuk ke teks yang sama.',
      ...kartu, tombol('Tambah bacaan', () => { U.stimulus.push(bacaanBaru()); simpanDraf(); render(); }, 'garis'));
    }

    // ---- paket ----
    function renderPaket() {
      const daftar = el('div', { class: 'daftar-paket' }, U.paket.map((p, i) => el('span', { class: 'chip-paket' },
        `Paket ${p}`, el('small', { class: 'redup', text: ` ${U.soal.filter((s) => s.paket.includes(p)).length} soal` }),
        U.paket.length > 1 ? el('button', { type: 'button', class: 'hapus-chip', 'aria-label': `Hapus paket ${p}`, onclick: () => { U.paket.splice(i, 1); U.soal.forEach((s) => { s.paket = s.paket.filter((x) => x !== p); }); simpanDraf(); render(); } }, '×') : null)));
      const tambah = tombol('Tambah paket', () => {
        const nama = huruf(U.paket.length);
        U.paket.push(nama);
        simpanDraf(); render();
      }, 'garis', { disabled: U.paket.length >= 8 });
      const bagiRata = U.paket.length > 1 ? tombol('Bagikan soal bergantian ke tiap paket', () => {
        U.soal.forEach((s, i) => { s.paket = [U.paket[i % U.paket.length]]; }); simpanDraf(); render();
      }) : null;
      return bagian('bagian-paket', 'Paket soal', U.paket.length > 1
        ? 'Mahasiswa dibagi rata ke setiap paket. Pilih paket untuk tiap soal di kartu soalnya.'
        : 'Satu paket berisi semua soal. Tambah paket bila ingin membuat beberapa versi soal setara.',
      daftar, el('div', { class: 'aksi-baris' }, tambah, bagiRata));
    }

    // ---- soal ----
    function renderSoal() {
      const izin = metodeDari(U.ujian.preset).tipe;
      const pilihTipe = el('select', { id: 'tipe-soal-baru', 'aria-label': 'Tipe soal baru' }, izin.map((t) => el('option', { value: t, text: TIPE[t] })));
      return bagian('bagian-soal', `Soal (${U.soal.length})`, null,
        ...U.soal.map((s, i) => renderKartuSoal(s, i)),
        el('div', { class: 'tambah-soal' },
          el('span', { class: 'label' }, 'Tambah soal'),
          pilihTipe,
          tombol('Tambah', () => tambahSoal(pilihTipe.value), 'utama')));
    }

    function tambahSoal(tipe, stimulusId) {
      const izin = metodeDari(U.ujian.preset).tipe;
      const s = soalBaru(tipe && izin.includes(tipe) ? tipe : izin[0], U.paket);
      if (stimulusId) {
        s.stimulus = stimulusId;
        let terakhir = -1;
        U.soal.forEach((x, i) => { if (x.stimulus === stimulusId) terakhir = i; });
        U.soal.splice(terakhir >= 0 ? terakhir + 1 : U.soal.length, 0, s);
      } else {
        const sebelum = U.soal[U.soal.length - 1];
        if (sebelum && U.ujian.preset === 'literasi') s.stimulus = sebelum.stimulus;
        U.soal.push(s);
      }
      simpanDraf(); render();
      const k = document.getElementById(`soal-${s._id}`);
      if (k) { k.scrollIntoView({ block: 'center' }); $('textarea', k)?.focus(); }
    }

    function renderKartuSoal(s, i) {
      const izin = metodeDari(U.ujian.preset).tipe;
      const tipeSalah = !izin.includes(s.tipe);
      const pilihTipe = el('select', {
        'aria-label': `Tipe soal ${i + 1}`,
        onchange: (e) => { U.soal[i] = soalBaru(e.target.value, U.paket, s); simpanDraf(); render(); }
      }, (tipeSalah ? [...izin, s.tipe] : izin).map((t) => el('option', { value: t, selected: t === s.tipe, text: TIPE[t] })));
      const pilihBacaan = el('select', { 'data-label-bacaan': '', 'aria-label': `Bacaan untuk soal ${i + 1}`, onchange: (e) => { s.stimulus = e.target.value; simpanDraf(); } }, opsiBacaan(s.stimulus));

      return el('article', { class: `kartu-soal${tipeSalah ? ' bermasalah' : ''}`, id: `soal-${s._id}` },
        el('div', { class: 'kartu-kepala' },
          el('span', { class: 'nomor-bulat', text: i + 1, 'aria-hidden': 'true' }),
          el('strong', { class: 'sr', text: `Soal ${i + 1}` }),
          pilihTipe,
          U.stimulus.length ? pilihBacaan : null,
          el('label', { class: 'bobot' }, el('span', null, 'Bobot'), masukan(s, 'bobot', { type: 'number', min: 0.5, step: 0.5, inputmode: 'decimal' })),
          el('div', { class: 'aksi-kartu' },
            tombol('Naik', () => pindah(i, -1), 'garis kecil', { disabled: i === 0, 'aria-label': `Pindahkan soal ${i + 1} ke atas` }),
            tombol('Turun', () => pindah(i, 1), 'garis kecil', { disabled: i === U.soal.length - 1, 'aria-label': `Pindahkan soal ${i + 1} ke bawah` }),
            tombol('Duplikat', () => { const c = JSON.parse(JSON.stringify(s)); c._id = idAcak(); U.soal.splice(i + 1, 0, c); simpanDraf(); render(); }),
            tombol('Hapus', () => { if (s.pertanyaan.trim() && !confirm(`Hapus soal ${i + 1}?`)) return; U.soal.splice(i, 1); simpanDraf(); render(); }))),
        kolom('Pertanyaan', masukan(s, 'pertanyaan', { baris: 3, placeholder: 'Tulis pertanyaan…' })),
        EDITOR[s.tipe](s, i),
        U.ujian.preset === 'dina' ? renderAtributSoal(s) : null,
        U.paket.length > 1 ? el('div', { class: 'pilih-paket' }, el('span', { class: 'label' }, 'Masuk ke paket'),
          U.paket.map((p) => el('label', { class: 'saklar' }, el('input', {
            type: 'checkbox', checked: s.paket.includes(p),
            onchange: (e) => { s.paket = e.target.checked ? [...new Set([...s.paket, p])] : s.paket.filter((x) => x !== p); simpanDraf(); }
          }), el('span', null, p)))) : null,
        el('details', { class: 'tambahan', open: !!s.pembahasan || null },
          el('summary', null, 'Pembahasan (opsional)'),
          masukan(s, 'pembahasan', { baris: 2, 'aria-label': `Pembahasan soal ${i + 1}` })));
    }

    function pindah(i, arah) {
      const j = i + arah;
      if (j < 0 || j >= U.soal.length) return;
      [U.soal[i], U.soal[j]] = [U.soal[j], U.soal[i]];
      simpanDraf(); render();
      document.getElementById(`soal-${U.soal[j]._id}`)?.scrollIntoView({ block: 'center' });
    }

    function renderAtributSoal(s) {
      return el('div', { class: 'pilih-atribut' }, el('span', { class: 'label' }, 'Atribut yang diukur'),
        U.atribut.map((a, j) => el('label', { class: 'saklar' }, el('input', {
          type: 'checkbox', checked: s.atribut.includes(a._id),
          onchange: (e) => { s.atribut = e.target.checked ? [...new Set([...s.atribut, a._id])] : s.atribut.filter((x) => x !== a._id); simpanDraf(); }
        }), el('span', null, `A${j + 1}${a.nama.trim() ? ' ' + a.nama.trim() : ''}`))));
    }

    // ---- editor daftar opsi dengan bulatan kunci ----
    function editorOpsi(s, kunciKey, arrKey, jamak, label) {
      const arr = s[arrKey];
      const nama = `kunci-${s._id}-${arrKey}`;
      const baris = arr.map((t, j) => {
        const terpilih = jamak ? s[kunciKey].includes(j) : s[kunciKey] === j;
        return el('div', { class: 'baris-opsi' },
          el('label', { class: 'kunci-bulat', title: 'Tandai sebagai kunci' },
            el('input', {
              type: jamak ? 'checkbox' : 'radio', name: nama, checked: terpilih, 'aria-label': `Jadikan pilihan ${huruf(j)} kunci`,
              onchange: (e) => {
                if (jamak) s[kunciKey] = e.target.checked ? [...new Set([...s[kunciKey], j])] : s[kunciKey].filter((x) => x !== j);
                else s[kunciKey] = j;
                simpanDraf();
              }
            }),
            el('span', { text: huruf(j) })),
          el('input', { value: t, placeholder: `Pilihan ${huruf(j)}`, 'aria-label': `Teks pilihan ${huruf(j)}`, oninput: (e) => { arr[j] = e.target.value; simpanDraf(); } }),
          tombol('×', () => {
            arr.splice(j, 1);
            const geser = (k) => (k === j ? null : k > j ? k - 1 : k);
            if (jamak) s[kunciKey] = s[kunciKey].map(geser).filter((k) => k != null);
            else s[kunciKey] = geser(s[kunciKey]);
            simpanDraf(); render();
          }, 'garis kecil hapus-opsi', { disabled: arr.length <= 2, 'aria-label': `Hapus pilihan ${huruf(j)}` }));
      });
      return el('div', { class: 'editor-opsi' },
        label ? el('span', { class: 'label' }, label) : null,
        el('p', { class: 'petunjuk-kolom' }, jamak ? 'Centang semua huruf yang merupakan jawaban benar.' : 'Klik huruf untuk menandai jawaban benar.'),
        ...baris,
        tombol('Tambah pilihan', () => { arr.push(''); simpanDraf(); render(); }, 'garis kecil', { disabled: arr.length >= 8 }));
    }

    const EDITOR = {
      pg: (s) => el('div', null, editorOpsi(s, 'kunci', 'opsi', false, 'Pilihan jawaban'),
        saklar(s, 'opsi_tetap', 'Jangan acak urutan pilihan soal ini (mis. ada pilihan "semua benar")')),

      pg_kompleks: (s) => el('div', null, editorOpsi(s, 'kunciBanyak', 'opsi', true, 'Pilihan jawaban'),
        saklar(s, 'parsial', 'Beri skor parsial (benar dipilih dikurangi salah dipilih)'),
        saklar(s, 'opsi_tetap', 'Jangan acak urutan pilihan soal ini')),

      benar_salah: (s) => el('div', { class: 'editor-opsi' }, el('span', { class: 'label' }, 'Pernyataan'),
        ...s.pernyataan.map((p, j) => el('div', { class: 'baris-bs' },
          el('input', { value: p.teks, placeholder: `Pernyataan ${j + 1}`, 'aria-label': `Pernyataan ${j + 1}`, oninput: (e) => { p.teks = e.target.value; simpanDraf(); } }),
          el('span', { class: 'pil-bs', role: 'radiogroup', 'aria-label': `Kunci pernyataan ${j + 1}` },
            [true, false].map((v) => el('label', null, el('input', { type: 'radio', name: `bs-${s._id}-${j}`, checked: p.benar === v, onchange: () => { p.benar = v; simpanDraf(); } }), el('span', { text: v ? 'Benar' : 'Salah' })))),
          tombol('×', () => { s.pernyataan.splice(j, 1); simpanDraf(); render(); }, 'garis kecil hapus-opsi', { disabled: s.pernyataan.length <= 1, 'aria-label': `Hapus pernyataan ${j + 1}` }))),
        tombol('Tambah pernyataan', () => { s.pernyataan.push({ teks: '', benar: null }); simpanDraf(); render(); }),
        saklar(s, 'penilaianParsial', 'Beri skor parsial per pernyataan')),

      menjodohkan: (s) => el('div', { class: 'editor-opsi' },
        el('span', { class: 'label' }, 'Pasangan yang benar'),
        el('p', { class: 'petunjuk-kolom' }, 'Tulis pasangan yang benar. Pilihan di sisi kanan akan diacak untuk mahasiswa.'),
        ...s.pasangan.map((p, j) => el('div', { class: 'baris-jodoh' },
          el('input', { value: p.kiri, placeholder: `Item ${j + 1}`, 'aria-label': `Item kiri ${j + 1}`, oninput: (e) => { p.kiri = e.target.value; simpanDraf(); } }),
          el('span', { class: 'panah', 'aria-hidden': 'true' }, '↔'),
          el('input', { value: p.kanan, placeholder: 'Pasangannya', 'aria-label': `Pasangan untuk item ${j + 1}`, oninput: (e) => { p.kanan = e.target.value; simpanDraf(); } }),
          tombol('×', () => { s.pasangan.splice(j, 1); simpanDraf(); render(); }, 'garis kecil hapus-opsi', { disabled: s.pasangan.length <= 2, 'aria-label': `Hapus pasangan ${j + 1}` }))),
        tombol('Tambah pasangan', () => { s.pasangan.push({ kiri: '', kanan: '' }); simpanDraf(); render(); }),
        el('span', { class: 'label sub' }, 'Pilihan pengecoh (opsional)'),
        ...s.pengecoh.map((p, j) => el('div', { class: 'baris-opsi tanpa-kunci' },
          el('input', { value: p, placeholder: 'Pilihan tambahan yang tidak berpasangan', 'aria-label': `Pengecoh ${j + 1}`, oninput: (e) => { s.pengecoh[j] = e.target.value; simpanDraf(); } }),
          tombol('×', () => { s.pengecoh.splice(j, 1); simpanDraf(); render(); }, 'garis kecil hapus-opsi', { 'aria-label': `Hapus pengecoh ${j + 1}` }))),
        tombol('Tambah pengecoh', () => { s.pengecoh.push(''); simpanDraf(); render(); })),

      isian_singkat: (s) => el('div', null,
        kolom('Jawaban yang diterima', masukan(s, 'jawaban', { baris: 3, placeholder: '5/6\nlima per enam' }), 'Satu jawaban per baris. Huruf besar/kecil dan spasi ganda diabaikan.'),
        saklar(s, 'numerik', 'Terima juga jawaban berupa angka dengan toleransi', () => render()),
        s.numerik ? el('div', { class: 'grid-3' },
          kolom('Nilai angka', masukan(s, 'nilai', { inputmode: 'decimal', placeholder: 'mis. 9,8' })),
          kolom('Toleransi ±', masukan(s, 'toleransi', { inputmode: 'decimal', placeholder: '0' })),
          kolom('Satuan (ditampilkan)', masukan(s, 'satuan', { placeholder: 'mis. m/s²' }))) : null),

      three_tier: (s) => el('div', { class: 'editor-tingkat' },
        editorOpsi(s, 'kunci', 'opsi', false, 'Bagian 1: pilihan jawaban'),
        editorOpsi(s, 'kunciAlasan', 'alasan', false, 'Bagian 2: pilihan alasan'),
        el('div', { class: 'grid-2' },
          kolom('Bagian 3: label yakin', el('input', { value: s.keyakinan[0], oninput: (e) => { s.keyakinan[0] = e.target.value; simpanDraf(); } })),
          kolom('Label tidak yakin', el('input', { value: s.keyakinan[1], oninput: (e) => { s.keyakinan[1] = e.target.value; simpanDraf(); } }))),
        saklar(s, 'skorDuaTingkat', 'Hitung benar tanpa melihat keyakinan (bawaan: benar hanya jika jawaban, alasan benar dan yakin)')),

      uraian: (s) => {
        const total = el('span', { class: 'redup' });
        const hitung = () => { total.textContent = `Skor maksimal rubrik: ${s.rubrik.reduce((t, r) => t + (Number(r.skor) || 0), 0)}`; };
        hitung();
        return el('div', { class: 'editor-opsi' },
          el('div', { class: 'grid-3' }, kolom('Batas kata (opsional)', masukan(s, 'maks_kata', { type: 'number', min: 0, inputmode: 'numeric' }))),
          el('span', { class: 'label' }, 'Rubrik penilaian'),
          ...s.rubrik.map((r, j) => el('div', { class: 'baris-rubrik' },
            el('input', { value: r.kriteria, placeholder: `Kriteria ${j + 1}`, 'aria-label': `Kriteria ${j + 1}`, oninput: (e) => { r.kriteria = e.target.value; simpanDraf(); } }),
            el('input', { type: 'number', min: 0, value: r.skor, placeholder: 'Skor', 'aria-label': `Skor kriteria ${j + 1}`, oninput: (e) => { r.skor = e.target.value; hitung(); simpanDraf(); } }),
            tombol('×', () => { s.rubrik.splice(j, 1); simpanDraf(); render(); }, 'garis kecil hapus-opsi', { disabled: s.rubrik.length <= 1, 'aria-label': `Hapus kriteria ${j + 1}` }))),
          el('div', { class: 'aksi-baris' }, tombol('Tambah kriteria', () => { s.rubrik.push({ kriteria: '', skor: '' }); simpanDraf(); render(); }), total));
      }
    };

    function renderKaki() {
      return el('div', { class: 'kaki-form' },
        tombol(opsi.mode === 'ganti' ? 'Simpan perubahan' : 'Simpan ujian', simpan, 'utama'));
    }

    // ---- simpan ----
    function tampilValidasi(hasil, pesanServer) {
      const p = $('#panel-validasi', wadah);
      p.replaceChildren();
      if (!hasil.galat.length && !pesanServer) return;
      const item = (x) => el('li', null, x.target
        ? el('a', { href: `#${x.target}`, onclick: (e) => { e.preventDefault(); document.getElementById(x.target)?.scrollIntoView({ block: 'center' }); } }, x.pesan)
        : x.pesan);
      p.append(el('div', { class: 'kotak-validasi', role: 'alert', tabindex: '-1' },
        el('strong', { text: pesanServer ? 'Server menolak ujian ini' : `Ada ${hasil.galat.length} hal yang perlu dilengkapi` }),
        pesanServer ? el('p', { text: pesanServer }) : el('ul', null, hasil.galat.slice(0, 12).map(item)),
        hasil.galat.length > 12 ? el('p', { class: 'redup', text: `dan ${hasil.galat.length - 12} lainnya.` }) : null));
      p.firstChild.focus();
      p.scrollIntoView({ block: 'start' });
    }

    async function simpan() {
      const hasil = validasi(U);
      if (hasil.galat.length) return tampilValidasi(hasil);
      if (hasil.waspada.length && !confirm(`Perhatikan:\n\n${hasil.waspada.map((w) => '• ' + w.pesan).join('\n')}\n\nTetap simpan?`)) return;
      const tombolS = $$('.tombol.utama', wadah).filter((b) => /Simpan/.test(b.textContent));
      tombolS.forEach((b) => { b.disabled = true; b.textContent = 'Menyimpan…'; });
      try {
        await opsi.onSimpan(keJSON(U));
        clearTimeout(jedaDraf);
        lokal.hapus(kunciDraf);
      } catch (e) {
        tampilValidasi({ galat: [] }, e.message);
        tombolS.forEach((b) => { b.disabled = false; b.textContent = opsi.mode === 'ganti' ? 'Simpan perubahan' : 'Simpan ujian'; });
      }
    }

    render();
    return { keJSON: () => keJSON(U), validasi: () => validasi(U) };
  }

  function toLokal(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const z = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}T${z(d.getHours())}:${z(d.getMinutes())}`;
  }

  window.Pembuat = { buka, dariJSON, keJSON, validasi, METODE, TIPE };
})();
