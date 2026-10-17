// 公式サイト(boatrace.jp)の出走表・直前情報・結果のページを、ブラウザから読めるように中継する小さなサーバー。
// Cloudflare Workers(無料枠)に置く想定。PCを起動しておく必要はありません。
// 使い方: README.md の「ライブ取得を使えるようにする」を参照。
//   GET {このWorkerのURL}?p=racelist|beforeinfo|raceresult&jcd=01&rno=7&hd=20261009   /   ?p=index&hd=20261009(開催場の一覧) / ?p=raceindex&jcd=01&hd=20261009(各Rの締切時刻)
// 呼べるのは上の5種類のページだけです(それ以外は拒否)。同じページは20秒キャッシュして、公式サイトへの負荷を抑えます。
export default {
  async fetch(req, env, ctx) {
    const allow = (env && env.ALLOW_ORIGIN) || "*";            // 自分のサイトのURLだけに限定したい場合は ALLOW_ORIGIN を設定
    const cors = { "Access-Control-Allow-Origin": allow, "Vary": "Origin" };
    if (req.method === "OPTIONS") return new Response(null, { headers: { ...cors, "Access-Control-Allow-Methods": "GET" } });
    const q = new URL(req.url).searchParams;
    const p = q.get("p"), jcd = q.get("jcd") || "", rno = q.get("rno") || "", hd = q.get("hd") || "";
    const isIndex = p === "index", isRaceIndex = p === "raceindex";      // index=その日の開催場の一覧 / raceindex=その場の各Rの締切予定時刻
    if (!(["racelist", "beforeinfo", "raceresult"].includes(p) && /^\d{2}$/.test(jcd) && /^\d{1,2}$/.test(rno) || isIndex || (isRaceIndex && /^\d{2}$/.test(jcd))) || !/^\d{8}$/.test(hd)) {
      return new Response("bad request", { status: 400, headers: cors });
    }
    const target = isIndex ? `https://www.boatrace.jp/owpc/pc/race/index?hd=${hd}` : isRaceIndex ? `https://www.boatrace.jp/owpc/pc/race/raceindex?jcd=${jcd}&hd=${hd}` : `https://www.boatrace.jp/owpc/pc/race/${p}?rno=${rno}&jcd=${jcd}&hd=${hd}`;
    const ttl = isIndex || isRaceIndex ? 600 : 20;          // 開催一覧・締切時刻は10分、出走表・直前情報は20秒だけ使い回す
    const cache = caches.default, key = new Request(target);
    let res = await cache.match(key);
    if (!res) {
      const r = await fetch(target, { headers: { "User-Agent": "Mozilla/5.0 (friends-note)" } });
      res = new Response(await r.text(), { status: r.status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "public, max-age=" + ttl } });
      if (r.ok) ctx.waitUntil(cache.put(key, res.clone()));
    }
    const out = new Response(res.body, res);
    Object.entries(cors).forEach(([k, v]) => out.headers.set(k, v));
    return out;
  },
};
