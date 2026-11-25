/* =========================================================
   Diagnostik kognitif: DINA (estimasi EM) dan NPC (nonparametrik)
   Masukan : X  = matriks respon 0/1 (N mahasiswa x J soal)
             Q  = Q-matrix 0/1      (J soal x K atribut)
   Berjalan di browser (window.Diagnostik) maupun Node (module.exports).
   ========================================================= */
(function (root) {
  'use strict';

  // Semua pola penguasaan 2^K, mis. K=3 -> [0,0,0],[1,0,0],...,[1,1,1]
  function semuaPola(K) {
    const pola = [];
    for (let l = 0; l < (1 << K); l++) pola.push(Array.from({ length: K }, (_, k) => (l >> k) & 1));
    return pola;
  }

  // Respon ideal: eta[l][j] = 1 bila pola l menguasai SEMUA atribut yang dibutuhkan soal j
  function responIdeal(pola, Q) {
    return pola.map((a) => Q.map((q) => (q.every((qk, k) => !qk || a[k]) ? 1 : 0)));
  }

  // Nilai null/undefined pada X = soal tidak dikerjakan (mis. paket berbeda); dilewati dalam perhitungan.
  const ada = (v) => v === 0 || v === 1;

  function periksa(X, Q) {
    if (!X.length) throw new Error('Belum ada data respon mahasiswa.');
    const J = Q.length;
    if (!J) throw new Error('Q-matrix kosong.');
    const K = Q[0].length;
    if (K < 1) throw new Error('Belum ada atribut.');
    if (K > 10) throw new Error('Maksimal 10 atribut agar perhitungan tetap ringan.');
    X.forEach((x, i) => { if (x.length !== J) throw new Error(`Baris respon ke-${i + 1} tidak sepanjang jumlah soal.`); });
    return { N: X.length, J, K };
  }

  /**
   * DINA dengan algoritma EM (marginal maximum likelihood).
   * Mengembalikan parameter slip/guess tiap soal, peluang penguasaan atribut
   * tiap mahasiswa, pola paling mungkin (MAP), dan proporsi pola di kelas.
   */
  function dina(X, Q, opsi = {}) {
    const { N, J, K } = periksa(X, Q);
    const maksIter = opsi.maksIter || 1000;
    const toleransi = opsi.toleransi || 1e-6;
    const pola = semuaPola(K);
    const L = pola.length;
    const eta = responIdeal(pola, Q);
    const BATAS = (v) => Math.min(0.999, Math.max(0.001, v));

    let s = new Array(J).fill(0.2);
    let g = new Array(J).fill(0.2);
    let prior = new Array(L).fill(1 / L);
    let post = [];
    let logLik = -Infinity;
    let iter = 0;

    for (iter = 1; iter <= maksIter; iter++) {
      // ---- E-step (dalam log agar stabil) ----
      const logP1 = eta.map((e) => e.map((v, j) => Math.log(v ? 1 - s[j] : g[j])));
      const logP0 = eta.map((e) => e.map((v, j) => Math.log(v ? s[j] : 1 - g[j])));
      const logPrior = prior.map((p) => Math.log(Math.max(p, 1e-300)));
      let ll = 0;
      post = X.map((x) => {
        const lw = new Array(L);
        let maks = -Infinity;
        for (let l = 0; l < L; l++) {
          let v = logPrior[l];
          for (let j = 0; j < J; j++) if (ada(x[j])) v += x[j] ? logP1[l][j] : logP0[l][j];
          lw[l] = v;
          if (v > maks) maks = v;
        }
        let jumlah = 0;
        for (let l = 0; l < L; l++) { lw[l] = Math.exp(lw[l] - maks); jumlah += lw[l]; }
        ll += maks + Math.log(jumlah);
        return lw.map((w) => w / jumlah);
      });

      // ---- M-step ----
      const sBaru = new Array(J), gBaru = new Array(J);
      for (let j = 0; j < J; j++) {
        let I1 = 0, R1 = 0, I0 = 0, R0 = 0;
        for (let i = 0; i < N; i++) {
          if (!ada(X[i][j])) continue;
          for (let l = 0; l < L; l++) {
            const w = post[i][l];
            if (eta[l][j]) { I1 += w; R1 += w * X[i][j]; } else { I0 += w; R0 += w * X[i][j]; }
          }
        }
        sBaru[j] = BATAS(I1 > 0 ? (I1 - R1) / I1 : 0.2);
        gBaru[j] = BATAS(I0 > 0 ? R0 / I0 : 0.2);
      }
      const priorBaru = new Array(L).fill(0);
      for (let i = 0; i < N; i++) for (let l = 0; l < L; l++) priorBaru[l] += post[i][l] / N;

      const beda = Math.max(...sBaru.map((v, j) => Math.abs(v - s[j])), ...gBaru.map((v, j) => Math.abs(v - g[j])));
      s = sBaru; g = gBaru; prior = priorBaru;
      const selesai = beda < toleransi && Math.abs(ll - logLik) < toleransi;
      logLik = ll;
      if (selesai) break;
    }

    const mahasiswa = post.map((p) => {
      const peluang = Array.from({ length: K }, (_, k) => p.reduce((t, w, l) => t + w * pola[l][k], 0));
      let lMaks = 0;
      p.forEach((w, l) => { if (w > p[lMaks]) lMaks = l; });
      return { peluang, kuasai: peluang.map((v) => v >= 0.5), polaMAP: pola[lMaks], peluangPolaMAP: p[lMaks] };
    });

    const nParam = 2 * J + (L - 1);
    return {
      model: 'dina',
      iterasi: Math.min(iter, maksIter),
      konvergen: iter <= maksIter,
      logLik,
      AIC: -2 * logLik + 2 * nParam,
      BIC: -2 * logLik + Math.log(N) * nParam,
      slip: s,
      guess: g,
      proporsiPola: pola.map((a, l) => ({ pola: a, proporsi: prior[l] })),
      mahasiswa,
      peringatan: N < 100 ? [`Jumlah peserta ${N} orang. Estimasi DINA paling stabil dengan ratusan peserta; untuk kelas kecil, bandingkan dengan hasil NPC.`] : []
    };
  }

  /**
   * NPC (Nonparametric Classification, Chiu & Douglas 2013).
   * Setiap mahasiswa dimasukkan ke pola yang respon idealnya paling dekat
   * (jarak Hamming berbobot). Cocok untuk kelas kecil karena tanpa estimasi parameter.
   */
  function npc(X, Q) {
    const { N, J, K } = periksa(X, Q);
    const pola = semuaPola(K);
    const eta = responIdeal(pola, Q);
    // bobot 1 / (p(1-p)) : soal dengan proporsi benar ekstrem lebih berpengaruh
    const p = Array.from({ length: J }, (_, j) => {
      const isi = X.filter((x) => ada(x[j]));
      return isi.length ? isi.reduce((t, x) => t + x[j], 0) / isi.length : 0;
    });
    const w = p.map((v) => (v > 0 && v < 1 ? 1 / (v * (1 - v)) : 1));

    const mahasiswa = X.map((x) => {
      let terbaik = [], jarakMin = Infinity;
      eta.forEach((e, l) => {
        let d = 0;
        for (let j = 0; j < J; j++) if (ada(x[j]) && x[j] !== e[j]) d += w[j];
        if (d < jarakMin - 1e-12) { jarakMin = d; terbaik = [l]; } else if (Math.abs(d - jarakMin) <= 1e-12) terbaik.push(l);
      });
      // bila seri, pilih pola dengan atribut paling sedikit (keputusan konservatif)
      terbaik.sort((a, b) => pola[a].reduce((t, v) => t + v, 0) - pola[b].reduce((t, v) => t + v, 0));
      const a = pola[terbaik[0]];
      return { peluang: null, kuasai: a.map(Boolean), polaMAP: a, jarak: jarakMin, seri: terbaik.length > 1 };
    });
    return { model: 'npc', mahasiswa, proporsiBenar: p, peringatan: [] };
  }

  const api = { dina, npc, semuaPola, responIdeal };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Diagnostik = api;
})(typeof window !== 'undefined' ? window : globalThis);
