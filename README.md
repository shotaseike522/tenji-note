# 展示後の見立てノート(公開用)

本日のレースを、展示が出たあとに見立てるための材料集です。投票の操作は行いません。

## 公開のしかた(コマンドは使いません。ブラウザだけで15分ほど)

### 1. 公式サイトを中継する Worker を作る(Cloudflare・無料)
1. https://dash.cloudflare.com/ でアカウントを作り(無料)、左メニューの「Workers & Pages」→「Create」→「Hello World」を選び、名前を付けて「Deploy」。
2. 「Edit code」を開き、中身を `worker/proxy.js` の内容に置き換えて「Deploy」。
3. 表示された URL(例 `https://boat-proxy.xxxx.workers.dev`)を控える。
4. (推奨)Worker の「Settings → Variables」で `ALLOW_ORIGIN` に、手順2で公開するサイトのURL(例 `https://あなたのID.github.io`)を設定する。

### 2. config.js に Worker の URL を書く
`config.js` の `proxy: ""` を、手順1で控えたURLに書き換える(末尾に `/` を付ける)。

### 3. GitHub Pages で公開する(無料)
1. https://github.com/new で新しいリポジトリを作る(Public)。
2. 「uploading an existing file」から、このフォルダの中身(`.nojekyll` も含む)をすべてドラッグして Commit。
3. リポジトリの「Settings → Pages」で、Branch を `main`、フォルダを `/ (root)` にして Save。数分後に `https://あなたのID.github.io/リポジトリ名/` で見られます。

## 注意
* 選手の成績の集計(`data/racers.json`)は作成時点のものです。最新のレースの結果は含まれていないので、定期的な更新の仕組みが別に必要です。
* 公式サイトへのアクセスは Worker が中継します。同じページは Worker が一定時間(締切時刻は10分、出走表・直前情報は20秒)使い回します。
* 公式サイトの利用条件を確認のうえ、公開してください。
