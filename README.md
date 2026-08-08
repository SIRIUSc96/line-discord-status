# LINE → Discord 通話ステータスボード

LINEでスタンプを送るだけで、Discordに「通話入れるよ」ステータスが表示されるツールです。

## ✨ 機能

- 🟢 **スタンプ1個** → サイレントにステータスON（通知なし）
- 🔔 **1時間以内にもう1個** → `@here` で通知を送信
- 🔙 **合計4個送信** → ステータス取り消し（間違えた時に）
- ⏰ **3時間で自動OFF**（設定変更可）
- 👥 **複数人対応** — 各自がBotにスタンプを送って操作

---

## 🚀 セットアップ手順

### 1. LINE Bot を作成する

1. [LINE Developers Console](https://developers.line.biz/console/) にログイン
2. 「プロバイダー」を作成（初回のみ）
3. 「新規チャネル」→「Messaging API」を選択
4. 以下を入力して作成：
   - チャネル名: `通話ステータス`（好きな名前でOK）
   - チャネル説明: 適当でOK
   - 大業種/小業種: 適当でOK
5. 作成後、以下の値をメモ：
   - **チャネルシークレット**: 「チャネル基本設定」タブ → チャネルシークレット
   - **チャネルアクセストークン**: 「Messaging API設定」タブ → 「チャネルアクセストークン（長期）」→「発行」

6. **応答設定**（重要）:
   - 「Messaging API設定」→「LINE公式アカウント機能」→「応答メッセージ」→ **無効** にする
   - 「あいさつメッセージ」→ **無効** にする

7. **Webhook設定**（デプロイ後に行う）:
   - 「Messaging API設定」→「Webhook URL」に `https://あなたのURL/webhook` を入力
   - 「Webhookの利用」→ **有効** にする
   - 「検証」ボタンを押して成功を確認

8. **友だち追加**:
   - 「Messaging API設定」→ QRコードをスマホで読み取って友だち追加
   - ステータスを出したい人全員が友だち追加する

### 2. Discord Bot を作成する

1. [Discord Developer Portal](https://discord.com/developers/applications) にログイン
2. 「New Application」→ 名前を入力して作成
3. 左メニュー「Bot」→ 以下を設定：
   - 「TOKEN」→「Reset Token」→ **トークンをメモ**（一度しか表示されない！）
   - 「MESSAGE CONTENT INTENT」→ **OFF のまま**でOK
4. 左メニュー「OAuth2」→「URL Generator」：
   - SCOPES: `bot` にチェック
   - BOT PERMISSIONS: `Send Messages`, `Manage Messages`, `Embed Links`, `Read Message History` にチェック
   - 生成された URL をブラウザで開いて、Bot をサーバーに招待
5. **ステータス表示用チャンネルのID**を取得：
   - Discord の設定 →「詳細設定」→「開発者モード」を **ON**
   - ステータスを表示したいテキストチャンネルを右クリック →「IDをコピー」

### 3. 環境変数を設定する

```bash
# .env.example を .env にコピー
cp .env.example .env
```

`.env` を編集して、メモした値を貼り付け：

```env
LINE_CHANNEL_SECRET=ここにチャネルシークレット
LINE_CHANNEL_ACCESS_TOKEN=ここにチャネルアクセストークン
DISCORD_BOT_TOKEN=ここにDiscordBotトークン
DISCORD_CHANNEL_ID=ここにチャンネルID
STATUS_TIMEOUT_HOURS=3
NOTIFY_WINDOW_MINUTES=60
PORT=3000
```

### 4. ローカルで動作確認する

```bash
# 依存パッケージをインストール
npm install

# サーバーを起動
npm start
```

起動すると Discord のチャンネルにステータスボードの Embed が作成されます。

#### LINE Webhook のテスト（ローカル）

ローカルでテストするには、ngrok などのトンネルツールが必要です：

```bash
# ngrok をインストール（初回のみ）
npm install -g ngrok

# トンネルを開始
ngrok http 3000
```

表示された `https://xxxx.ngrok.io` を LINE の Webhook URL に設定：
- `https://xxxx.ngrok.io/webhook`

---

## 🌐 Render にデプロイする（無料）

1. [Render](https://render.com/) にアカウント作成
2. GitHub にこのリポジトリを push
3. Render ダッシュボード →「New +」→「Web Service」
4. GitHub リポジトリを接続
5. 設定：
   - **Name**: `line-discord-status`（好きな名前）
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `npm start`
   - **Instance Type**: `Free`
6. 「Environment」→ 環境変数を追加（`.env` の中身を全て）
7. 「Deploy」

デプロイ完了後、表示される URL を LINE の Webhook URL に設定：
- `https://あなたのサービス名.onrender.com/webhook`

### ⚠️ Render 無料枠の注意点

Render の無料枠では、15分間 HTTP リクエストがないとサービスが停止します。
常時稼働させるには、[UptimeRobot](https://uptimerobot.com/)（無料）で定期的にヘルスチェックを設定してください：

1. UptimeRobot にアカウント作成
2. 「Add New Monitor」→ HTTP(s) を選択
3. URL: `https://あなたのサービス名.onrender.com/`
4. Monitoring Interval: 5 minutes

---

## 👥 ユーザーマッピング（オプション）

デフォルトでは LINE の表示名がそのまま Discord に表示されます。
Discord 用に別の名前を使いたい場合は `data/user_mapping.json` を編集します：

```json
{
  "U1234567890abcdef": "たろう",
  "Uabcdef1234567890": "はなこ"
}
```

LINE ユーザーID はサーバーのログに表示されます：
```
📩 スタンプ受信: LINE太郎 (userId: U1234567890abcdef, stickerId: 52002734)
```

---

## 📖 使い方まとめ

| 操作 | 結果 |
|---|---|
| LINE Bot にスタンプ1個 | 🟢 ステータスON（サイレント） |
| 1時間以内にもう1個 | 🔔 @here で通知 |
| さらに2個送る（計4個） | 🔙 ステータス取り消し |
| 何もしない | ⏰ 3時間で自動OFF |
| 1時間経過後にスタンプ | ステータスOFF |

---

## 🔧 トラブルシューティング

### LINE の Webhook 検証が失敗する
- Webhook URL が正しいか確認（末尾 `/webhook` が必要）
- チャネルシークレットが正しいか確認
- サーバーが起動しているか確認

### Discord に Embed が表示されない
- Bot がサーバーに招待されているか確認
- Bot にチャンネルへの送信権限があるか確認
- DISCORD_CHANNEL_ID が正しいか確認（テキストチャンネルのIDが必要）

### スタンプを送っても反応がない
- LINE Bot を友だち追加しているか確認
- LINE の応答メッセージが **無効** になっているか確認
- Webhook の利用が **有効** になっているか確認
- サーバーのログを確認
