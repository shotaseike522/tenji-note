/* 分析エンジン: 出走表+直前情報(race)と選手の集計(racers)、全体の表(T)から、画面に出す数字を計算する。
   保存データでもライブ取得でも同じ関数を通す。ブラウザだけで動く(サーバー不要)。 */
const Engine = (() => {
  const dayNum = (dateStr) => { const [y, m, d] = dateStr.split("-").map(Number); return Math.round(Date.UTC(y, m - 1, d) / 86400000); };
  const sq = (x) => x * x;

  // --- 乱数(結果が毎回同じになるよう固定シード) ---
  function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function gauss(r) { let u = 0, v = 0; while (u === 0) u = r(); v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

  // --- STの予測(直近成績・このコースでの成績・F後かどうか) ---
  function stModel(racer, course, dnum, T) {
    const R = T.ridge, b = R.beta;
    if (!racer) return { mu: b[5 + course - 1], sd: R.sd_default, known: false, h100: 0, hall: 0, hc: 0, fresh: 0 };
    const [s100, c100, sq100, sall, call] = racer.st;
    const h100 = s100 / (c100 + R.shrink.h100), hall = sall / (call + R.shrink.hall);
    const stc = racer.stc[course - 1], hc = stc[1] / (stc[0] + R.shrink.hc);
    const lastF = racer.f[1], fresh = (lastF != null && dnum - lastF >= 0 && dnum - lastF <= 60) ? 1 : 0;
    const mu = b[0] * h100 + b[1] * hall + b[2] * hc + b[3] * fresh + b[4] * racer.f[0] / 3 + b[5 + course - 1];
    const sd = c100 >= 20 ? Math.sqrt(Math.max(sq100 / c100 - sq(s100 / c100), 0)) : R.sd_default;
    return { mu, sd: sd || R.sd_default, known: true, h100, hall, hc, fresh };
  }
  // z -> 確率(等濃度回帰の表を線形補間)
  function isoP(T, delta, z) {
    const g = T.iso.zgrid, p = T.iso.p[String(delta)];
    if (z <= g[0]) return p[0]; if (z >= g[g.length - 1]) return p[p.length - 1];
    const step = g[1] - g[0], i = Math.floor((z - g[0]) / step), f = (z - g[i]) / step;
    return p[i] * (1 - f) + p[i + 1] * f;
  }
  // 「A が B より delta 秒以上先に出る」確率
  function aheadP(T, A, B, delta) { const s = T.ridge.kappa * Math.sqrt(sq(A.sd) + sq(B.sd)); return isoP(T, delta, ((B.mu - A.mu) - delta) / s); }

  // --- 選手の分析 ---
  const tier = (pt, hi, lo) => pt >= hi ? "得意" : pt >= lo ? "やや得意" : pt > -lo ? "標準" : pt > -hi ? "やや苦手" : "苦手";
  function racerAnalysis(racer, boat, course, jcd, T) {
    if (!racer) return null;
    const base = T.course_base;                      // [勝率, 2着率, 入着率]
    const prof = [];
    for (let c = 1; c <= 6; c++) {
      const [n, w, t] = racer.c3[c - 1], [na, wa, ta] = racer.cs[c - 1], b3 = base[String(c)][2], b1 = base[String(c)][0];
      const k = 10;
      prof.push({ c, n, win: n ? w / n : null, top3: n ? t / n : null, lift: (t + k * b3) / (n + k) / b3, liftWin: (w + k * b1) / (n + k) / b1, nAll: na, top3All: na ? ta / na : null, base3: b3, base1: b1 });
    }
    const nTot = prof.reduce((a, p) => a + p.n, 0), tTot = racer.c3.reduce((a, r) => a + r[2], 0), wTot = racer.c3.reduce((a, r) => a + r[1], 0);
    const rc = racer.rc.map(([s, n]) => ({ pt: 100 * s / (n + 20), n }));
    const best = rc.map((x, i) => ({ c: i + 1, pt: x.pt, n: x.n })).filter((x) => x.n >= 30).sort((a, b) => b.pt - a.pt)[0] || null;
    const rv = racer.rv && racer.rv[String(jcd)] ? racer.rv[String(jcd)] : null;
    const venuePt = rv ? 100 * rv[0] / (rv[1] + 20) : null;
    const home = T.venues[String(jcd)] && boat.br === T.venues[String(jcd)].branch;
    return { prof, nTot, top3Rate: nTot ? tTot / nTot : null, winRate: nTot ? wTot / nTot : null, coursePt: rc[course - 1].pt, courseN: rc[course - 1].n, courseTier: tier(rc[course - 1].pt, 4, 2),
             bestCourse: best, venuePt, venueN: rv ? rv[1] : 0, venueTier: venuePt == null ? null : tier(venuePt, 4, 2), home };
  }

  // --- 展示タイム ---
  function exhibition(boats) {
    const v = boats.map((b) => b.tj); const ok = v.filter((x) => x != null && x > 0);
    if (ok.length < 3) return boats.map(() => null);
    const mean = ok.reduce((a, b) => a + b, 0) / ok.length, best = Math.min(...ok), sd = Math.sqrt(ok.reduce((a, b) => a + sq(b - mean), 0) / ok.length) || 0.05;
    const sorted = [...ok].sort((a, b) => a - b);
    return v.map((x) => x == null || x <= 0 ? null : { t: x, rank: sorted.indexOf(x) + 1, diffBest: x - best, diffMean: x - mean, z: (x - mean) / sd });
  }

  // --- 天候 × 競艇場 ---
  function weatherTendency(race, jcd, T) {
    const W = T.weather[String(jcd)]; if (!W) return null;
    const ws = race.ws, wv = race.wv;
    const wsb = ws == null ? null : ws <= 1 ? 0 : ws <= 3 ? 1 : ws <= 5 ? 2 : 3, wvb = wv == null ? null : wv <= 2 ? 0 : wv <= 5 ? 1 : 2;
    const cell = wsb == null || wvb == null ? null : W.cells[String(wsb) + String(wvb)];
    const [bn, bw, bm, bp] = W.base;
    let label = null, cmp = null;
    if (cell) { const [n, w, m, p] = cell; cmp = { n, win1: w, man: m, med: p, baseWin1: bw, baseMan: bm, baseMed: bp };
      if (n >= 50) label = m >= bm * 1.25 || w <= bw - 0.05 ? "荒れ気味" : (m <= bm * 0.8 && w >= bw + 0.04 ? "堅め" : "標準"); }
    return { base: { n: bn, win1: bw, man: bm, med: bp }, cell: cmp, label };
  }

  // --- 本体 ---
  function analyze(race, racers, T) {
    const dnum = dayNum(race.date), jcd = race.jcd;
    const boats = race.boats.map((b) => ({ ...b, course: b.c || b.k }));
    const byCourse = {}; boats.forEach((b) => { byCourse[b.course] = b; });
    boats.forEach((b) => { b.racer = racers[b.id] || null; b.st = stModel(b.racer, b.course, dnum, T); });
    // コース順の隣
    boats.forEach((b) => {
      const inn = byCourse[b.course - 1], out = byCourse[b.course + 1];
      b.lead = {
        in03: inn ? aheadP(T, b.st, inn.st, 0.03) : null, in05: inn ? aheadP(T, b.st, inn.st, 0.05) : null,
        out03: out ? aheadP(T, b.st, out.st, 0.03) : null, out05: out ? aheadP(T, b.st, out.st, 0.05) : null,
        overrun05: inn ? aheadP(T, inn.st, b.st, 0.05) : null,         // 内側の隣に0.05秒以上先行される確率
        overrunOut05: out ? aheadP(T, out.st, b.st, 0.05) : null,      // 外側の隣に0.05秒以上先行される確率
      };
    });
    // 6艇のSTを乱数で何通りも発生させ、最速になる確率・2番手を0.05秒以上離して抜け出す確率を出す
    const r = rng(20260630 + dnum * 31 + jcd * 7 + race.r), M = 4000, K = T.ridge.kappa;
    const cnt = boats.map(() => ({ fast: 0, top2: 0, clear: 0, last: 0 }));
    for (let m = 0; m < M; m++) {
      const s = boats.map((b) => b.st.mu + K * b.st.sd * gauss(r));
      const order = s.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
      cnt[order[0][1]].fast++; cnt[order[0][1]].top2++; cnt[order[1][1]].top2++; cnt[order[5][1]].last++;
      if (order[1][0] - order[0][0] >= 0.045) cnt[order[0][1]].clear++;
    }
    boats.forEach((b, i) => { b.st.pFast = cnt[i].fast / M; b.st.pTop2 = cnt[i].top2 / M; b.st.pClear = cnt[i].clear / M; b.st.pLast = cnt[i].last / M; });
    // 先行幅別の過去の着順率(そのコース)
    const bins = [[3, "同じ"], [4, "0.01〜0.02秒先行"], [5, "0.03〜0.04秒先行"], [6, "0.05〜0.07秒先行"], [7, "0.08秒以上先行"]];
    boats.forEach((b) => {
      const tab = T.lead_table[String(b.course)]; b.leadRates = bins.map(([i, lab]) => ({ label: lab, n: tab[i][0], win: tab[i][1], second: tab[i][2], top3: tab[i][3] }));
      let n = 0, w = 0, s2 = 0, t3 = 0; [0, 1, 2].forEach((i) => { n += tab[i][0]; w += tab[i][0] * tab[i][1]; s2 += tab[i][0] * tab[i][2]; t3 += tab[i][0] * tab[i][3]; });
      b.lateRates = { label: "0.01秒以上遅れ", n, win: w / n, second: s2 / n, top3: t3 / n };
      const L = T.leader_table[String(b.course)]; b.leaderRates = { n: L[0], win: L[1], second: L[2], top3: L[3] };
      b.ana = racerAnalysis(b.racer, b, b.course, jcd, T);
    });
    const ex = exhibition(boats); boats.forEach((b, i) => { b.ex = ex[i]; });
    const entry = boats.slice().sort((a, b) => a.course - b.course).map((b) => b.k);
    const changed = boats.filter((b) => b.course !== b.k);
    return { boats, entry, changed, weather: weatherTendency(race, jcd, T), dnum };
  }
  return { analyze, dayNum, aheadP, stModel };
})();
if (typeof module !== "undefined") module.exports = Engine;
