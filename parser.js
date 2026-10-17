/* 公式サイト(出走表・直前情報)のHTMLを、サイトの内部形式(保存データと同じ形)に変換する。 */
const Parser = (() => {
  const z2h = (s) => (s || "").replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const num = (s) => { const v = parseFloat(z2h(String(s == null ? "" : s)).replace(/[^\d.\-]/g, "")); return Number.isFinite(v) ? v : null; };
  const lines = (td) => td ? td.innerHTML.split(/<br\s*\/?>/i).map((x) => x.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim()) : [];
  const doc = (html) => new DOMParser().parseFromString(html, "text/html");
  // 風向の画像番号(is-windN)→方角。公式の画像番号と過去データの風向を突き合わせて確認済みのものだけ入れる(build/wind_map.json)。
  let WIND_MAP = {};
  function setWindMap(m) { WIND_MAP = m || {}; }
  const WEATHER = { 1: "晴", 2: "曇", 3: "雨", 4: "雪", 5: "霧" };

  function racelist(html) {
    const d = doc(html), tables = d.querySelectorAll("table");
    const tbs = tables.length > 1 ? tables[1].querySelectorAll("tbody") : [];
    const boats = [];
    tbs.forEach((tb) => {
      const tr0 = tb.querySelector("tr"); if (!tr0) return;
      const tds = tr0.children;
      const k = num(tds[0].textContent); if (!k) return;
      const info = tds[2], l1 = info.querySelectorAll("div");
      const m = (l1[0] ? l1[0].textContent : "").match(/(\d{4})\s*\/\s*([A-Z0-9]+)/);
      const brl = lines(l1[2] || null), age = num((brl[1] || "").split("/")[0]), wt = num((brl[1] || "").split("/")[1]);
      const nat = lines(tds[4]), loc = lines(tds[5]), mo = lines(tds[6]), bo = lines(tds[7]), fl = lines(tds[3]);
      boats.push({ k, c: k, id: m ? m[1] : null, gr: m ? m[2] : null, nm: ((l1[1] ? l1[1].textContent : "") || "").replace(/\s+/g, " ").trim(), br: (brl[0] || "").split("/")[0].trim(), ag: age, wt,
        wr: num(nat[0]), w2: num(nat[1]), lw: num(loc[0]), l2: num(loc[1]), mo: num(mo[0]), m2: num(mo[1]), bo: num(bo[0]), b2: num(bo[1]), tj: null,
        fl: { f: num(fl[0]), l: num(fl[1]), avgST: num(fl[2]) } });
    });
    const body = d.body ? d.body.textContent : "";
    const dist = (body.match(/(\d{4})m/) || [])[1];
    const title = (d.querySelector(".heading2_titleName") || {}).textContent;
    return { boats, dist: dist ? +dist : null, title: title ? title.trim() : null };
  }

  function beforeinfo(html) {
    const d = doc(html), tbl = d.querySelector("table.is-w748");
    const boats = {};
    if (tbl) tbl.querySelectorAll("tbody").forEach((tb) => {
      const tr0 = tb.querySelector("tr"); if (!tr0) return;
      const tds = tr0.children, k = num(tds[0].textContent); if (!k) return;
      const parts = Array.from((tds[7] || tb).querySelectorAll("li")).map((x) => x.textContent.trim()).filter(Boolean);
      boats[k] = { tj: num(tds[4] && tds[4].textContent), tilt: num(tds[5] && tds[5].textContent), prop: (tds[6] && tds[6].textContent.trim()) || "", parts };
    });
    // スタート展示: 上から順に 1コース,2コース,...
    const start = [];
    d.querySelectorAll("table.is-w238 tbody tr").forEach((tr) => {
      const n = tr.querySelector(".table1_boatImageNumber, [class*=boatImage1Number]"), t = tr.querySelector("[class*=boatImage1Time]");
      if (n) start.push({ k: num(n.textContent), st: t ? t.textContent.trim() : "" });
    });
    const w = {};
    const gv = (sel) => { const e = d.querySelector(sel); return e ? e.textContent.replace(/\s+/g, " ").trim() : null; };
    w.temp = num(gv(".weather1_bodyUnit.is-direction .weather1_bodyUnitLabelData"));
    const wi = d.querySelector(".weather1_bodyUnit.is-weather .weather1_bodyUnitImage"), wcls = wi ? (wi.className.match(/is-weather(\d+)/) || [])[1] : null;
    w.w = gv(".weather1_bodyUnit.is-weather .weather1_bodyUnitLabelTitle") || WEATHER[wcls] || null;
    w.ws = num(gv(".weather1_bodyUnit.is-wind .weather1_bodyUnitLabelData"));
    const wd = d.querySelector(".weather1_bodyUnit.is-windDirection .weather1_bodyUnitImage"), dcls = wd ? (wd.className.match(/is-wind(\d+)/) || [])[1] : null;
    w.wdCode = dcls ? +dcls : null; w.wd = dcls && WIND_MAP[dcls] ? WIND_MAP[dcls] : null;
    w.wv = num(gv(".weather1_bodyUnit.is-wave .weather1_bodyUnitLabelData"));
    w.water = num(gv(".weather1_bodyUnit.is-waterTemperature .weather1_bodyUnitLabelData"));
    const asof = gv(".weather1_title");
    return { boats, start, weather: w, asof };
  }

  // 出走表 + 直前情報 -> 内部形式
  function merge(rl, bi, date, jcd, r) {
    const boats = rl.boats.map((b) => ({ ...b }));
    boats.forEach((b) => { const x = bi && bi.boats[b.k]; if (x) { b.tj = x.tj; b.tilt = x.tilt; b.prop = x.prop; b.parts = x.parts; } });
    let entryFromStart = false;
    if (bi && bi.start && bi.start.length === 6) {
      const seen = new Set(); bi.start.forEach((s, i) => { const b = boats.find((x) => x.k === s.k); if (b) { b.c = i + 1; b.stEx = s.st; seen.add(s.k); } });
      entryFromStart = seen.size === 6;
    }
    const w = (bi && bi.weather) || {};
    return { date, jcd, r, d: rl.dist, w: w.w || null, wd: w.wd || null, wdCode: w.wdCode, ws: w.ws, wv: w.wv, temp: w.temp, water: w.water, weatherAsOf: bi ? bi.asof : null, entryFromStart, title: rl.title, boats };
  }
  // 開催場ごとの各Rの締切予定時刻(raceindex)
  function raceindex(html) {
    const d = doc(html), races = [];
    d.querySelectorAll("table tr").forEach((tr) => {
      const tds = tr.querySelectorAll("td"); if (tds.length < 2) return;
      const m = (tds[0].textContent || "").trim().match(/^(\d{1,2})R$/), t = (tds[1].textContent || "").trim().match(/^(\d{1,2}):(\d{2})/);
      if (m && t) races.push({ r: +m[1], time: String(t[1]).padStart(2, "0") + ":" + t[2] });
    });
    const title = (d.querySelector(".heading2_titleName") || {}).textContent;
    return { races, title: title ? title.replace(/\s+/g, " ").trim() : null };
  }
  return { racelist, beforeinfo, merge, setWindMap, raceindex };
})();
if (typeof module !== "undefined") module.exports = Parser;
