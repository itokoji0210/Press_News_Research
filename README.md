# ニューストレンド写真ネタ

RSSやURL付きSNSシグナルから、写真・動画・ドローンで追う価値がある時事ネタ候補を作ります。候補は必ず取得記事やSNS投稿のURLに紐づくため、根拠URLのないネタは表示されません。

## 使い方

```bash
npm run analyze:trends
npm run score:topics
npm start
```

画面は `http://localhost:3000` です。

## データ

- `data/trends.json`: 収集した記事、頻出語、急上昇ワード、根拠URL付き写真ネタ
- `data/feedback.json`: 使える、いまいち、取材済み、要確認、非表示、後で見るの評価履歴
- `data/scored-topics.json`: 評価を反映した表示用データ
- `data/social-signals.json`: SNS由来のURL付き情報を手動または別ツールで投入する場所

`data/social-signals.json` の例:

```json
{
  "items": [
    {
      "source": "X",
      "title": "駅前の巨大行列が話題",
      "summary": "投稿や関連リンクの概要",
      "url": "https://example.com/post/123",
      "publishedAt": "2026-05-13T09:00:00+09:00"
    }
  ]
}
```

## 補足

社内ネットワークなどで証明書エラーが出る場合は、Node.js に社内CAを設定してください。検証用に限り `NODE_TLS_REJECT_UNAUTHORIZED=0` でも動作確認できますが、通常運用では推奨しません。
