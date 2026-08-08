const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'status.json');
const MAPPING_FILE = path.join(DATA_DIR, 'user_mapping.json');

/**
 * ユーザーステータスの状態管理
 *
 * 状態遷移:
 *   OFF → スタンプ → ON_SILENT (count=1)
 *   ON_SILENT + 1時間以内 → スタンプ → ON_NOTIFIED (count=2) + @here 通知
 *   ON_NOTIFIED + 1時間以内 → スタンプ → ON_NOTIFIED (count=3) 変化なし
 *   ON_NOTIFIED + 1時間以内 → スタンプ → OFF (count=4) 取り消し
 *   いずれかのON + 1時間経過後 → スタンプ → OFF
 *   3時間で自動OFF
 */
class StatusManager {
  constructor(config) {
    this.config = config;
    this.users = {};
    this.userMapping = {};
    this._load();
    this._loadMapping();
  }

  // --- 永続化 ---

  _load() {
    try {
      if (fs.existsSync(DATA_FILE)) {
        this.users = JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
        console.log(`📂 ステータスデータ読み込み: ${Object.keys(this.users).length} ユーザー`);
      }
    } catch (e) {
      console.error('⚠️ ステータスデータの読み込みに失敗:', e.message);
      this.users = {};
    }
  }

  _save() {
    try {
      if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
      }
      fs.writeFileSync(DATA_FILE, JSON.stringify(this.users, null, 2));
    } catch (e) {
      console.error('⚠️ ステータスデータの保存に失敗:', e.message);
    }
  }

  _loadMapping() {
    try {
      if (fs.existsSync(MAPPING_FILE)) {
        this.userMapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
        console.log(`📂 ユーザーマッピング読み込み: ${Object.keys(this.userMapping).length} ユーザー`);
      } else {
        // サンプルファイルを作成
        if (!fs.existsSync(DATA_DIR)) {
          fs.mkdirSync(DATA_DIR, { recursive: true });
        }
        const sample = {
          _comment: 'LINE ユーザーID → Discord 表示名 のマッピング。不要なら空のままでOK（LINE表示名がそのまま使われます）',
          _example_line_user_id: 'Discord表示名',
        };
        fs.writeFileSync(MAPPING_FILE, JSON.stringify(sample, null, 2));
        console.log('📂 ユーザーマッピングのサンプルを作成しました: data/user_mapping.json');
      }
    } catch (e) {
      this.userMapping = {};
    }
  }

  // --- ユーザー表示名 ---

  _getDisplayName(lineUserId, lineDisplayName) {
    return this.userMapping[lineUserId] || lineDisplayName;
  }

  // --- メインロジック ---

  /**
   * スタンプ受信時の処理
   * @param {string} userId - LINE ユーザーID
   * @param {string} lineDisplayName - LINE の表示名
   * @returns {{ action: 'ON_SILENT'|'NOTIFY'|'NONE'|'OFF', displayName: string }}
   */
  handleStamp(userId, lineDisplayName) {
    const now = Date.now();
    const user = this.users[userId];
    const displayName = this._getDisplayName(userId, lineDisplayName);
    const windowMs = this.config.notifyWindowMinutes * 60 * 1000;

    // --- OFF状態 or 未登録 → ステータスON ---
    if (!user || user.state === 'OFF') {
      this.users[userId] = {
        state: 'ON_SILENT',
        count: 1,
        startedAt: now,
        lineDisplayName,
        discordDisplayName: displayName,
      };
      this._save();
      return { action: 'ON_SILENT', displayName };
    }

    // --- 1時間ウィンドウ外 → OFF ---
    const elapsed = now - user.startedAt;
    if (elapsed > windowMs) {
      this.users[userId] = {
        state: 'OFF',
        count: 0,
        startedAt: 0,
        lineDisplayName,
        discordDisplayName: displayName,
      };
      this._save();
      return { action: 'OFF', displayName };
    }

    // --- 1時間ウィンドウ内 → カウントで分岐 ---
    user.count += 1;
    user.lineDisplayName = lineDisplayName;
    user.discordDisplayName = displayName;

    let action = 'NONE';

    switch (user.count) {
      case 2:
        // 2個目 → 通知送信
        user.state = 'ON_NOTIFIED';
        action = 'NOTIFY';
        break;

      case 3:
        // 3個目 → 変化なし
        action = 'NONE';
        break;

      default:
        // 4個目以上 → OFF（取り消し）
        if (user.count >= 4) {
          user.state = 'OFF';
          user.count = 0;
          user.startedAt = 0;
          action = 'OFF';
        }
        break;
    }

    this._save();
    return { action, displayName };
  }

  // --- ステータス照会 ---

  /**
   * アクティブなユーザー一覧を取得
   */
  getActiveUsers() {
    const active = [];
    for (const [userId, data] of Object.entries(this.users)) {
      if (data.state !== 'OFF' && data.state) {
        active.push({
          userId,
          state: data.state,
          displayName: data.discordDisplayName || data.lineDisplayName,
          startedAt: data.startedAt,
        });
      }
    }
    return active;
  }

  // --- 自動タイムアウト ---

  /**
   * タイムアウトしたユーザーを OFF にする
   * @returns {Array<{userId: string, displayName: string}>} タイムアウトしたユーザー
   */
  checkTimeouts() {
    const now = Date.now();
    const timeoutMs = this.config.statusTimeoutHours * 60 * 60 * 1000;
    const expired = [];

    for (const [userId, data] of Object.entries(this.users)) {
      if (data.state !== 'OFF' && data.state && data.startedAt) {
        if (now - data.startedAt > timeoutMs) {
          expired.push({
            userId,
            displayName: data.discordDisplayName || data.lineDisplayName,
          });
          data.state = 'OFF';
          data.count = 0;
          data.startedAt = 0;
        }
      }
    }

    if (expired.length > 0) {
      this._save();
    }

    return expired;
  }
}

module.exports = StatusManager;
