// 設定。proxy には、公式サイトを中継する Cloudflare Worker のURL(worker/proxy.js を置いたもの)を書きます。
// 例: proxy: "https://boat-proxy.あなたのアカウント.workers.dev/"
window.SITE_CONFIG = {
  proxy: "https://boat-proxy.ssst-mac1.workers.dev/",
  teleboat: "https://ib.mbrace.or.jp/",
  official: "https://www.boatrace.jp/owpc/pc/race/"
};
