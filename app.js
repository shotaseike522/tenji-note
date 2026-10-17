/* 画面の動き: 今日の開催場とレースを選ぶ → 公式サイトから出走表・直前情報を取得(保存データがあればそれを使う) → 分析 → 軸・相手・穴を表示 */
(() => {
  const CFG = window.SITE_CONFIG || {};
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const pct = (x, d = 0) => x == null ? "–" : (100 * x).toFixed(d) + "%";
  const pt = (x, d = 1) => x == null ? "–" : (x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d) + "pt";
  const fix = (x, d = 2) => x == null ? "–" : x.toFixed(d);
  const bn = (b) => (b.nm || "").replace(/\s+/g, "");
  const Q = new URLSearchParams(location.search);
  const cache = { tables: null, index: null, racers: null, days: {}, venues: {} };
  const state = { date: null, jcd: null, r: null, dateFixed: Q.get("date") || null };
  const VENUES = {};

  const show = (id, on) => { $(id).hidden = !on; };
  function msg(t) { $("msg").textContent = t || ""; show("msg", !!t); }
  async function getJSON(path) { const r = await fetch(path, { cache: "no-cache" }); if (!r.ok) throw new Error(path + " " + r.status); return r.json(); }

  // ---------------- 日付と当日データ ----------------
  const FETCH_BEFORE_MIN = 10;                           // 締切予定時刻のこの分数前から、出走表・直前情報を取得できる
  const FORCE = Q.get("force") === "1" || !!Q.get("date");   // 動作確認用: 時間の制限を外す
  const todayJST = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const dateLabel = (d) => d.replace(/-/g, "/") + "(" + WD[new Date(d + "T00:00:00Z").getUTCDay()] + ")";
  const pad2 = (n) => String(n).padStart(2, "0");
  const savedFor = (date) => (cache.index.dates.find((d) => d.date === date) || null);
  const useSaved = (date) => !!savedFor(date) && Q.get("live") !== "1";
  async function proxyGet(params) {
    const u = CFG.proxy + (CFG.proxy.includes("?") ? "&" : "?") + params;
    const res = await fetch(u); if (!res.ok) throw new Error("取得に失敗しました(" + res.status + ")"); return res.text();
  }
  const minutesTo = (date, hhmm) => (Date.parse(date + "T" + hhmm + ":00+09:00") - Date.now()) / 60000;
  const hhmmOf = (ms) => { const d = new Date(ms + 9 * 3600 * 1000); return pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes()); };
  const minusMin = (date, hhmm, m) => hhmmOf(Date.parse(date + "T" + hhmm + ":00+09:00") - m * 60000);
  const statusOf = (date, hhmm) => { const m = minutesTo(date, hhmm); return m > FETCH_BEFORE_MIN ? "wait" : m >= 0 ? "open" : "past"; };
  const DAYKEY = "boat-day:";
  const saveDay = (day) => { try { localStorage.setItem(DAYKEY + day.date, JSON.stringify(day)); } catch (e) { /* 保存できなくても動く */ } };
  const readDay = (date) => { try { const s = localStorage.getItem(DAYKEY + date); return s ? JSON.parse(s) : null; } catch (e) { return null; } };

  // ① 当日データ取得: 開催している競艇場と、各Rの締切予定時刻
  async function loadDay() {
    const btn = $("loadDay"); btn.classList.add("loading"); btn.textContent = "取得中…"; msg("");
    try {
      if (!CFG.proxy) throw new Error("公式サイトから取得するには config.js の proxy の設定が必要です");
      const date = state.dateFixed || todayJST(); state.date = date; $("dateLabel").textContent = dateLabel(date);
      const html = await proxyGet("p=index&hd=" + date.replace(/-/g, ""));
      const jcds = [...new Set([...html.matchAll(/raceindex\?jcd=(\d\d)/g)].map((m) => +m[1]))].sort((a, b) => a - b);
      const venues = []; let done = 0; const queue = jcds.slice();
      const worker = async () => {
        while (queue.length) {
          const j = queue.shift();
          try { const x = Parser.raceindex(await proxyGet("p=raceindex&jcd=" + pad2(j) + "&hd=" + date.replace(/-/g, ""))); venues.push({ jcd: j, title: x.title, races: x.races }); }
          catch (e) { venues.push({ jcd: j, title: null, races: [], error: true }); }
          done++; $("dayNote").textContent = "取得中… " + done + "/" + jcds.length + "場";
        }
      };
      await Promise.all([worker(), worker(), worker(), worker()]);
      venues.sort((a, b) => a.jcd - b.jcd);
      state.day = { date, fetchedAt: Date.now(), venues }; saveDay(state.day);
      state.jcd = null; state.r = null; show("selected", false); show("race", false);
      renderSchedule();
    } catch (e) { msg("当日データを取得できませんでした: " + e.message); }
    finally { btn.classList.remove("loading"); btn.textContent = "当日データ取得"; }
  }
  function renderSchedule() {
    const day = state.day;
    if (!day) { show("schedule", false); return; }
    show("schedule", true);
    const vs = day.venues, bad = vs.filter((v) => v.error || !v.races.length).length;
    if (!vs.length) { $("dayNote").textContent = "本日は開催がありません(" + hhmmOf(day.fetchedAt) + "時点)。"; $("schedule").innerHTML = ""; show("schedule", false); return; }
    $("dayNote").textContent = vs.length + "場で開催(" + hhmmOf(day.fetchedAt) + "に取得)。" + (bad ? bad + "場は時刻を取得できませんでした。" : "");
    const all = []; vs.forEach((v) => v.races.forEach((r) => all.push({ j: v.jcd, r: r.r, t: r.time, m: minutesTo(day.date, r.time) })));
    const next = all.filter((x) => x.m >= 0).sort((a, b) => a.m - b.m).slice(0, 6);
    const nextHtml = next.length ? `<div class="nextList"><div class="small">これから締切のレース</div><div class="nextRow">${next.map((x) => `<button class="rc st-${statusOf(day.date, x.t)}" data-j="${x.j}" data-r="${x.r}" type="button"><span class="rn">${esc(VENUES[x.j] || x.j)} ${x.r}R</span><span class="rt">${x.t}</span></button>`).join("")}</div></div>` : '<p class="small">本日のレースはすべて締切済みです。</p>';
    $("schedule").innerHTML = `<h3>本日の開催</h3><p class="small">数字は締切予定時刻です。締切の${FETCH_BEFORE_MIN}分前から、出走表と展示の情報を取得できます。</p>${nextHtml}
      ${vs.map((v) => `<div class="vcard"><div class="vhead"><b>${esc(VENUES[v.jcd] || v.jcd)}</b>${v.title ? ` <span class="small">${esc(v.title)}</span>` : ""}</div>
        <div class="rgrid">${v.races.map((r) => `<button class="rc st-${statusOf(day.date, r.time)}${state.jcd === v.jcd && state.r === r.r ? " sel" : ""}" data-j="${v.jcd}" data-r="${r.r}" type="button"><span class="rn">${r.r}R</span><span class="rt">${r.time}</span></button>`).join("") || '<span class="small">時刻を取得できませんでした</span>'}</div></div>`).join("")}`;
  }
  // ② レースを選ぶ → 締切の10分前から「レース情報取得」が押せる
  function selectRace(j, r) { state.jcd = j; state.r = r; show("race", false); msg(""); renderSchedule(); renderSelected(); $("selected").scrollIntoView({ behavior: "smooth", block: "nearest" }); }
  function selStatus(day, rc) {
    const m = minutesTo(day.date, rc.time);
    if (m > FETCH_BEFORE_MIN) return { can: FORCE, txt: `締切の${FETCH_BEFORE_MIN}分前(${minusMin(day.date, rc.time, FETCH_BEFORE_MIN)})から取得できます。あと${Math.ceil(m - FETCH_BEFORE_MIN)}分。` };
    if (m >= 0) return { can: true, txt: `取得できます(締切まであと${Math.ceil(m)}分)。展示が出ていれば、展示の分も加わります。` };
    return { can: true, txt: "締切時刻を過ぎています(結果の確認などに取得できます)。" };
  }
  function renderSelected() {
    const day = state.day, v = day && day.venues.find((x) => x.jcd === state.jcd), rc = v && v.races.find((x) => x.r === state.r);
    if (!rc) { show("selected", false); return; }
    const s = selStatus(day, rc); state.time = rc.time;
    $("selected").innerHTML = `<div class="selHead"><b>${esc(VENUES[v.jcd] || v.jcd)} ${rc.r}R</b> <span class="meta">締切予定 ${rc.time}</span></div>
      <p class="note" id="selStatus">${esc(s.txt)}</p><button id="loadRace" class="btn wide" type="button"${s.can ? "" : " disabled"}>レース情報取得</button>`;
    $("loadRace").onclick = loadRace; show("selected", true);
  }
  // 15秒ごとに、時刻による状態(色・押せるか・あと何分)を更新。日付が変わったら当日データを消す
  function tick() {
    const day = state.day; if (!day) return;
    if (!state.dateFixed && day.date !== todayJST()) {
      state.day = null; state.jcd = null; state.r = null; state.date = todayJST(); $("dateLabel").textContent = dateLabel(state.date);
      show("schedule", false); show("selected", false); show("race", false); $("dayNote").textContent = "日付が変わりました。「当日データ取得」を押してください。"; return;
    }
    document.querySelectorAll(".rc").forEach((b) => {
      const v = day.venues.find((x) => x.jcd === +b.dataset.j), rc = v && v.races.find((x) => x.r === +b.dataset.r); if (!rc) return;
      b.classList.remove("st-wait", "st-open", "st-past"); b.classList.add("st-" + statusOf(day.date, rc.time));
    });
    const v = state.jcd && day.venues.find((x) => x.jcd === state.jcd), rc = v && v.races.find((x) => x.r === state.r), btn = $("loadRace");
    if (rc && btn && !btn.classList.contains("loading")) { const s = selStatus(day, rc); $("selStatus").textContent = s.txt; btn.disabled = !s.can; }
  }

  // ---------------- データ取得 ----------------
  async function loadSaved(date, jcd, r) {
    const key = date.replace(/-/g, "");
    if (!cache.days[key]) cache.days[key] = await getJSON("data/days/" + key + ".json");
    const day = cache.days[key], v = day.venues[String(jcd)], rc = v && v.races[String(r)];
    if (!rc) return null;
    return { race: { date, jcd, r, d: rc.d, w: rc.w, wd: rc.wd, ws: rc.ws, wv: rc.wv, boats: rc.boats, entryFromStart: true, saved: true }, racers: day.racers, res: rc.res };
  }
  const viaProxy = (p, jcd, r, date) => proxyGet("p=" + p + "&jcd=" + String(jcd).padStart(2, "0") + "&rno=" + r + "&hd=" + date.replace(/-/g, ""));
  async function loadLive(date, jcd, r) {
    if (!CFG.proxy) throw new Error("公式サイトから取得するには config.js の proxy の設定が必要です");
    if (!cache.racers) cache.racers = await getJSON("data/racers.json");
    const [a, b] = await Promise.all([viaProxy("racelist", jcd, r, date), viaProxy("beforeinfo", jcd, r, date).catch(() => null)]);
    const rl = Parser.racelist(a), bi = b ? Parser.beforeinfo(b) : null;
    if (!rl.boats.length) throw new Error("出走表を読み取れませんでした(このレースはまだ公開されていないか、開催がありません)");
    return { race: Parser.merge(rl, bi, date, jcd, r), racers: cache.racers.racers, res: null };
  }

  // ---------------- 計算: 4つの要素をすべて「3着以内に入る率のpt」にそろえる ----------------
  const tierCls = (t) => t === "得意" || t === "やや得意" ? "pos" : t === "苦手" || t === "やや苦手" ? "neg" : "mid";
  function interp(tab, d) {
    if (d <= tab[0][0]) return tab[0][1]; if (d >= tab[tab.length - 1][0]) return tab[tab.length - 1][1];
    for (let i = 1; i < tab.length; i++) if (d <= tab[i][0]) { const [x0, y0] = tab[i - 1], [x1, y1] = tab[i]; return y0 + (y1 - y0) * (d - x0) / (x1 - x0); }
    return 0;
  }
  // 展示タイムの「6艇平均との差(秒)」→ pt(68万レースの実測、build/exh_check.py)。3着以内用と1着用
  const EXH_PTS = [[-0.12, 8.2], [-0.075, 5.8], [-0.035, 3.6], [0, 0], [0.035, -3.9], [0.075, -6.5], [0.12, -7.8]];
  const EXH_PTS1 = [[-0.12, 8.8], [-0.075, 4.9], [-0.035, 2.2], [0, 0], [0.035, -2.3], [0.075, -3.1], [0.12, -3.2]];
  // スタート: 隣(1コースは外側の隣)より0.05秒以上先行する確率と、6艇で最速になる確率を、過去の実際の入着率との関係(build/start_pt.py)でptに換算
  function startFrom(b, tab) {
    const c = tab && tab[String(b.course)]; if (!c) return null;
    const pa = b.course === 1 ? b.lead.out05 : b.lead.in05, sumF = Object.values(tab).reduce((s, v) => s + v[3], 0);
    const [ka, kf, ma, mf] = c; let v = 0, any = false;
    if (pa != null) { v += ka * (pa - ma); any = true; }
    if (b.st && b.st.known !== false) { v += kf * (b.st.pFast - mf / sumF); any = true; }
    return any ? 100 * v : null;
  }
  // モーター・ボートの2連率(6艇平均との差)の効果。土台の入着率p0のlogitに足す(build/motor_pt.py)
  const sig = (z) => 1 / (1 + Math.exp(-z)), lgt = (p) => Math.log(p / (1 - p));
  function prepare(A) {
    const ok = (x) => typeof x === "number" && isFinite(x) && x > 0;
    const ms = A.boats.map((b) => b.m2).filter(ok), bs = A.boats.map((b) => b.b2).filter(ok);
    const mm = ms.length >= 4 ? ms.reduce((s, x) => s + x, 0) / ms.length : null, bm = bs.length >= 4 ? bs.reduce((s, x) => s + x, 0) / bs.length : null;
    A.boats.forEach((b) => { b.mrel = mm != null && ok(b.m2) ? (b.m2 - mm) / 10 : 0; b.brel = bm != null && ok(b.b2) ? (b.b2 - bm) / 10 : 0; });
  }
  function motorPt(b, T, p0) {
    const m = T.motor; if (!m || (b.mrel === 0 && b.brel === 0)) return 0;
    const nc = (b.wr != null ? b.wr : m.nw_mean) - m.nw_mean;
    const d = m.b_mo * b.mrel + m.b_bo * b.brel + m.b_mo_nw * b.mrel * nc + m.b_bo_nw * b.brel * nc;
    const q = Math.min(0.97, Math.max(0.03, p0)); return 100 * (sig(lgt(q) + d) - q);
  }
  function ptsOf(b, T) {
    const a = b.ana, ex = b.ex;
    const p = { st: startFrom(b, T.start_pt), course: a && a.courseN > 0 ? a.coursePt : null, venue: a && a.venuePt != null ? a.venuePt : null, ex: ex ? interp(EXH_PTS, ex.diffMean) : null };
    const base3 = T.course_base[String(b.course)][2], pr = a ? a.prof.find((x) => x.c === b.course) : null;
    p.base = pr ? base3 * pr.lift : base3;                 // このコースでのその選手の過去の入着率(少ないときは全体平均に寄せた値)
    p.motor = motorPt(b, T, p.base);
    p.rate = Math.min(0.95, Math.max(0.03, p.base + ((p.venue || 0) + (p.st || 0) + (p.ex || 0) + p.motor) / 100));
    p.lift = pr ? pr.lift : null;
    return p;
  }
  // 6艇の1着率の見込み(合計100%): 軸の判定用
  function winRates(A, T) {
    const raw = A.boats.map((b) => {
      const base1 = T.course_base[String(b.course)][0], base3 = T.course_base[String(b.course)][2], a = b.ana, pr = a ? a.prof.find((x) => x.c === b.course) : null, sc = base1 / base3;
      const venue = a && a.venuePt != null ? a.venuePt * sc : 0, st = startFrom(b, T.start_pt1) || 0, ex = b.ex ? interp(EXH_PTS1, b.ex.diffMean) : 0;
      const motor = motorPt(b, T, pr ? base3 * pr.lift : base3) * sc;
      return { b, base1, p: Math.max(0.003, (pr ? base1 * pr.liftWin : base1) + (venue + st + ex + motor) / 100) };
    });
    const sum = raw.reduce((s, x) => s + x.p, 0), out = new Map();
    raw.forEach((x) => out.set(x.b.k, { p1: x.p / sum, base1: x.base1, ratio: x.p / sum / x.base1 }));
    return out;
  }
  function courseMark(b) {
    const a = b.ana; if (!a || a.courseN < 10) return '<span class="mid" title="このコースの過去データが少ない">？</span>';
    const m = { "得意": ["◎", "pos"], "やや得意": ["○", "pos"], "標準": ["―", "mid"], "やや苦手": ["△", "neg"], "苦手": ["▲", "neg"] }[a.courseTier];
    return `<span class="${m[1]} mark" title="${esc(a.courseTier)} ${pt(a.coursePt)}">${m[0]}</span>`;
  }
  const ptCell = (x, d = 1) => x == null ? '<span class="mid">–</span>' : `<span class="${x >= 1 ? "pos" : x <= -1 ? "neg" : "mid"}">${(x >= 0 ? "+" : "−") + Math.abs(x).toFixed(d)}</span>`;

  // ---------------- 表示 ----------------
  function officialLinks(date, jcd, r) {
    const hd = date.replace(/-/g, ""), j = String(jcd).padStart(2, "0"), O = CFG.official, q = "?rno=" + r + "&jcd=" + j + "&hd=" + hd;
    return `<div class="links"><a class="tele" href="${esc(CFG.teleboat)}" target="_blank" rel="noopener">テレボートを開く</a>
      <a href="${O}racelist${q}" target="_blank" rel="noopener">出走表</a><a href="${O}beforeinfo${q}" target="_blank" rel="noopener">直前情報</a>
      <a href="${O}odds3t${q}" target="_blank" rel="noopener">オッズ</a><a href="${O}raceresult${q}" target="_blank" rel="noopener">結果</a></div>`;
  }
  function renderHead(race, A) {
    const wtxt = [race.w, race.wd ? "風" + race.wd : null, race.ws != null ? race.ws + "m" : null, race.wv != null ? "波" + race.wv + "cm" : null].filter(Boolean).join(" ");
    const noEx = !A.boats.some((b) => b.ex);
    $("raceHead").innerHTML = `<h2>${esc(VENUES[race.jcd] || race.jcd)} ${race.r}R <span class="meta">${race.d ? race.d + "m" : ""}${state.time && !state.dateFixed ? " ・締切予定 " + state.time : ""}</span></h2>
      <div class="meta">${esc(wtxt) || "気象情報なし"}${race.weatherAsOf ? " ・" + esc(race.weatherAsOf) : ""}</div>
      <div class="meta">進入: <b>${A.entry.join("-")}</b>${A.changed.length ? " <span class=\"badge chg\">枠なりではない</span> " + A.changed.map((b) => b.k + "号艇→" + b.course + "コース").join("、") : " (枠なり)"}${race.entryFromStart ? "" : " <span class=\"badge\">スタート展示前: 枠なりと仮定</span>"}</div>
      ${noEx ? '<div class="meta warnline">展示タイムはまだ出ていません(出たら「表示する」で更新すると、展示の分が加わります)。</div>' : ""}
      ${officialLinks(race.date, race.jcd, race.r)}`;
  }
  // 根拠の部品(ptの大きい要素だけを出す)
  const chip = (lab, v) => `<span class="rs ${v >= 0 ? "pos" : "neg"}">${lab} ${(v >= 0 ? "+" : "−") + Math.abs(v).toFixed(1)}</span>`;
  function reasonChips(b, p, onlyPlus) {
    const items = [["この場", p.venue], ["スタート", p.st], ["展示", p.ex], ["モーター・ボート", p.motor]].filter(([, v]) => v != null && Math.abs(v) >= 1.5 && (!onlyPlus || v > 0));
    return items.map(([l, v]) => chip(l, v)).join("");
  }
  function courseLine(b, p) {
    const a = b.ana, pr = a && a.prof.find((x) => x.c === b.course);
    let s = pr && pr.n >= 10 ? `${b.course}コースの過去成績: 1着率 ${pct(pr.win)}・入着率 ${pct(pr.top3)}(全体比 ×${pr.lift.toFixed(2)}、${pr.n}走)` : `${b.course}コースの過去データは少なめ(${pr ? pr.n : 0}走)`;
    if (b.course !== b.k) s += `。${b.k}号艇→${b.course}コースへ変更`;
    return s;
  }
  // 軸・相手・穴(無理に出さない。条件に合う艇がなければ「なし」)
  function renderRoles(A, T) {
    const W = winRates(A, T), P = new Map(A.boats.map((b) => [b.k, ptsOf(b, T)]));
    const nm = (b) => `<span class="no no${b.k}">${b.k}</span> <b>${esc(bn(b))}</b>`;
    const axis = A.boats.filter((b) => W.get(b.k).p1 >= 0.25).sort((x, y) => W.get(y.k).p1 - W.get(x.k).p1).slice(0, 2);
    const rest = A.boats.filter((b) => !axis.includes(b)).sort((x, y) => P.get(y.k).rate - P.get(x.k).rate);
    const partners = rest.filter((b) => P.get(b.k).rate >= 0.40).slice(0, 3);
    const plus = (b) => { const p = P.get(b.k); return (p.st || 0) + (p.ex || 0) + (p.venue || 0) + (p.course || 0) + (p.motor || 0); };
    const holes = rest.filter((b) => !partners.includes(b) && plus(b) >= 8).sort((x, y) => plus(y) - plus(x)).slice(0, 2);
    const item = (b, head, extra) => `<div class="pick">${nm(b)} <span class="big">${head}</span><div class="why">${esc(courseLine(b, P.get(b.k)))}</div><div class="chips2">${extra}</div></div>`;
    const row = (lab, cls, body, note) => `<div class="role"><span class="rl ${cls}">${lab}</span><div class="rbody">${body}${note ? `<p class="small">${note}</p>` : ""}</div></div>`;
    const axisHtml = axis.length ? axis.map((b) => item(b, "1着率 " + pct(W.get(b.k).p1), reasonChips(b, P.get(b.k), false))).join("") : '<span class="mid">なし(1着率が25%以上の艇がいません)</span>';
    const partHtml = partners.length ? partners.map((b) => item(b, "入着率 " + pct(P.get(b.k).rate), reasonChips(b, P.get(b.k), false))).join("") : '<span class="mid">なし(入着率40%以上の艇がいません)</span>';
    const holeHtml = holes.length ? holes.map((b) => item(b, "入着率 " + pct(P.get(b.k).rate), reasonChips(b, P.get(b.k), true) + (P.get(b.k).course >= 4 ? chip("このコースが得意", P.get(b.k).course) : ""))).join("") : '<span class="mid">なし</span>';
    $("roles").innerHTML = `<h3>軸・相手・穴</h3>${row("軸", "ax", axisHtml, "1着率の見込みが25%以上の艇(6艇の平均は約17%)")}
      ${row("相手", "pa", partHtml, "軸以外で3着以内に入る率(入着率)が40%以上の艇")}
      ${row("穴", "ho", holeHtml, holes.length ? "相手に選ばなかった艇のうち、プラスの要素(pt)の合計が+8以上の艇。過去の実績では3着以内に約4割入りますが、オッズもほぼ同程度に見込んでいるため、お買い得とは限りません。" : "相手に選ばなかった艇のうち、プラスの要素の合計が+8以上の艇")}`;
  }
  function renderOverview(A, T) {
    const rows = A.boats.slice().sort((x, y) => x.course - y.course).map((b) => {
      const p = ptsOf(b, T);
      return `<tr><td class="l"><span class="no no${b.k}">${b.k}</span> <span class="nm">${esc(bn(b))}</span>${b.course !== b.k ? ` <span class="badge chg">${b.course}c</span>` : ""}</td>
        <td>${courseMark(b)}</td><td>${ptCell(p.venue)}</td><td>${ptCell(p.st)}</td><td>${ptCell(p.ex)}</td><td>${ptCell(p.motor)}</td><td class="tot">${pct(p.rate)}</td></tr>`;
    }).join("");
    $("overview").innerHTML = `<h3>6艇の一覧(進入順)</h3><div class="scroll"><table class="cmp"><thead><tr><th>選手</th><th>コース</th><th>この場</th><th>スタート</th><th>展示</th><th>機力</th><th>入着率</th></tr></thead><tbody>${rows}</tbody></table></div>
      <p class="small"><b>コース</b>=今回の進入コースでの過去成績からの得意度(◎得意 ○やや得意 ―標準 △やや苦手 ▲苦手 ？データ少)。<b>この場・スタート・展示・機力(モーター・ボート)</b>は、3着以内に入る率を何ポイント(pt)上げ下げするか(同じ基準)。<b>入着率</b>=3着以内に入る見込みの率(このコースでのその選手の過去の入着率を土台に、4つのptを足したもの)。目安であり、1着の確率ではありません。</p>`;
  }
  // 選手ごと: コース別の成績と全体との比較だけ
  function boatCard(b) {
    const a = b.ana, pr = a && a.prof.find((x) => x.c === b.course);
    const head = `<summary class="bhead"><span class="no no${b.k}">${b.k}</span><div class="who"><b>${esc(bn(b))}</b> <small>${esc(b.gr || "")} ${esc(b.br || "")} ${b.ag != null ? b.ag + "歳" : ""} 全国勝率 ${fix(b.wr)}</small>
      ${b.course !== b.k ? `<span class="badge chg">${b.course}コースへ</span>` : ""}
      <div class="chips">${pr ? `<span class="chip ${pr.lift >= 1.1 ? "pos" : pr.lift <= 0.9 ? "neg" : "mid"}">${b.course}コース 全体比 ×${pr.lift.toFixed(2)}</span>` : ""}</div></div></summary>`;
    if (!a) return `<details class="boat">${head}<div class="blk"><p class="small">この選手の過去成績データがありません(新人など)。</p></div></details>`;
    const prof = a.prof.map((p) => `<tr class="${p.c === b.course ? "res" : ""}"><td>${p.c}コース${p.c === b.course ? " ◀" : ""}</td><td>${p.n}</td><td>${p.win == null ? "–" : pct(p.win)}</td><td>${p.top3 == null ? "–" : pct(p.top3)}</td><td>${pct(p.base3)}</td><td class="${p.lift >= 1.1 ? "pos" : p.lift <= 0.9 ? "neg" : "mid"}">×${p.lift.toFixed(2)}</td></tr>`).join("");
    return `<details class="boat">${head}<div class="blk"><div class="scroll"><table><thead><tr><th>コース</th><th>走</th><th>勝率</th><th>入着率</th><th>全体の入着率</th><th>全体比</th></tr></thead><tbody>${prof}</tbody></table></div>
      <p class="small">直近300走のコース別成績。全体の入着率=全選手のそのコースの平均。全体比=その選手の入着率が全体の何倍か(件数が少ないと1に近づけて表示)。${a.bestCourse ? "最も得意なのは <b>" + a.bestCourse.c + "コース</b>。" : ""}</p></div></details>`;
  }
  function renderResult(res, A) {
    if (!res) { show("resultBox", false); return; }
    const rows = A.boats.slice().sort((x, y) => (parseInt(res.rk[x.k - 1]) || 9) - (parseInt(res.rk[y.k - 1]) || 9)).map((b) => `<tr><td class="rk">${res.rk[b.k - 1] || "–"}着</td><td class="l"><span class="no no${b.k}">${b.k}</span> ${esc(bn(b))}</td><td>${b.course}コース</td><td>ST ${esc(res.st[b.k - 1] || "–")}</td><td>${esc(res.tm[b.k - 1] || "")}</td></tr>`).join("");
    $("resultBox").innerHTML = `<h3>結果(確認用)</h3><div class="scroll"><table><tbody>${rows}</tbody></table></div>
      <p class="small">3連単 ${esc(res.p3[0] || "–")} ${res.p3[1] != null ? res.p3[1].toLocaleString() + "円" : ""} ／ 2連単 ${esc(res.p2[0] || "–")} ${res.p2[1] != null ? res.p2[1].toLocaleString() + "円" : ""}</p>`;
  }
  // ---------------- 予想メモ ----------------
  const MKEY = "boat-memo:";
  function memoUI(race) {
    const key = race.date + "-" + race.jcd + "-" + race.r, store = (() => { try { return window.localStorage; } catch (e) { return null; } })();
    const cur = store ? (store.getItem(MKEY + key) || "") : "";
    const list = store ? Object.keys(store).filter((k) => k.startsWith(MKEY)).sort().reverse().slice(0, 15) : [];
    $("memoBox").innerHTML = `<h3>自分の予想メモ</h3><textarea id="memo" placeholder="買い目や、決め手にした材料を書き留めておけます(この端末にだけ保存)">${esc(cur)}</textarea>
      <div class="row"><button id="memoSave" class="btn">メモを保存</button><a class="chipLink" href="${esc(CFG.teleboat)}" target="_blank" rel="noopener">テレボートを開く</a><span id="memoOk" class="small"></span></div>
      ${list.length ? '<div class="memoList"><h3 style="margin-top:10px">保存したメモ</h3>' + list.map((k) => `<div><span>${esc(k.slice(MKEY.length))}</span><span class="small">${esc((store.getItem(k) || "").slice(0, 24))}</span></div>`).join("") + "</div>" : ""}`;
    $("memoSave").onclick = () => { if (!store) { $("memoOk").textContent = "この環境では保存できません"; return; } const v = $("memo").value; if (v.trim()) store.setItem(MKEY + key, v); else store.removeItem(MKEY + key); $("memoOk").textContent = "保存しました"; };
  }

  // ---------------- 本体 ----------------
  let seq = 0;
  async function showRace(date, jcd, r) {
    const my = ++seq; msg(""); show("race", false);
    const data = useSaved(date) ? await loadSaved(date, jcd, r) : await loadLive(date, jcd, r);
    if (my !== seq) return;
    if (!data) { msg("このレースのデータはありません。"); return; }
    const A = Engine.analyze(data.race, data.racers, cache.tables); prepare(A);
    renderHead(data.race, A); renderRoles(A, cache.tables); renderOverview(A, cache.tables);
    $("boats").innerHTML = A.boats.slice().sort((a, b) => a.k - b.k).map(boatCard).join("");
    $("resultBox").hidden = true;
    if (data.res) { const d = document.createElement("div"); d.className = "card"; d.innerHTML = '<button class="btn" id="revealBtn">結果を見る(確認用)</button>'; $("boats").appendChild(d); $("revealBtn").onclick = () => { renderResult(data.res, A); show("resultBox", true); $("resultBox").scrollIntoView({ behavior: "smooth" }); }; }
    memoUI(data.race); show("race", true);
    window.__last = { race: data.race, A };            // 動作確認用
    $("race").scrollIntoView({ behavior: "smooth", block: "start" });
  }
  // ② レース情報取得ボタン
  async function loadRace() {
    const btn = $("loadRace"); if (!btn || btn.disabled) return;
    btn.classList.add("loading"); btn.textContent = "取得中…";
    try {
      const day = state.day, v = day.venues.find((x) => x.jcd === state.jcd), rc = v && v.races.find((x) => x.r === state.r);
      if (rc && !selStatus(day, rc).can) { msg("締切の" + FETCH_BEFORE_MIN + "分前から取得できます。"); return; }
      await showRace(day.date, state.jcd, state.r);
    } catch (e) { msg("読み込みに失敗しました: " + e.message); }
    finally { btn.classList.remove("loading"); btn.textContent = "レース情報取得"; tick(); }
  }

  async function init() {
    try {
      cache.tables = await getJSON("data/tables.json"); cache.index = await getJSON("data/index.json");
      Object.entries(cache.tables.venues).forEach(([k, v]) => { VENUES[k] = v.name; });
      try { cache.racers = await getJSON("data/racers.json"); } catch (e) { cache.racers = { asof: "–", racers: {} }; }
    } catch (e) { msg("データを読み込めません: " + e.message); return; }
    state.date = state.dateFixed || todayJST(); $("dateLabel").textContent = dateLabel(state.date);
    $("loadDay").onclick = loadDay;
    $("schedule").addEventListener("click", (e) => { const b = e.target.closest(".rc"); if (b) selectRace(+b.dataset.j, +b.dataset.r); });
    const cached = readDay(state.date);                      // 同じ日に開き直したときは、前回取得した時刻表を使う(最新にするには「当日データ取得」)
    if (cached && cached.venues && cached.venues.length) { state.day = cached; renderSchedule(); }
    else $("dayNote").textContent = "「当日データ取得」を押すと、開催している競艇場と各レースの締切予定時刻を取得します。";
    setInterval(tick, 15000); document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
    if (Q.get("date") && Q.get("jcd") && Q.get("r")) { try { await showRace(Q.get("date"), +Q.get("jcd"), +Q.get("r")); } catch (e) { msg("読み込みに失敗しました: " + e.message); } }     // 動作確認用の直接表示
  }
  window.__app = { loadRace, loadDay, selectRace, state, cache, ptsOf, winRates, prepare, tick, showRace };
  init();
})();
