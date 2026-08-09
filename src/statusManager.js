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
   * ステータス更新（スタンプ or テキスト）
   * @param {string} userId - LINE ユーザーID
   * @param {string} lineDisplayName - LINE の表示名
   * @param {string} type - 'STAMP' | 'TEXT_ANY' | 'TEXT_WORK' | 'TEXT_LISTEN' | 'TEXT_OFF'
   * @returns {{ action: 'ON_ANY'|'ON_WORK'|'ON_LISTEN'|'NOTIFY'|'NONE'|'OFF', displayName: string }}
   */
  handleUpdate(userId, lineDisplayName, type) {
    const now = Date.now();
    const displayName = this._getDisplayName(userId, lineDisplayName);
    const windowMs = this.config.notifyWindowMinutes * 60 * 1000;
    let user = this.users[userId];

    // 新規・OFFからの復帰用の初期データ
    if (!user || user.state === 'OFF') {
      user = {
        state: 'OFF',
        count: 0,
        startedAt: 0,
        lineDisplayName,
        discordDisplayName: displayName,
      };
      this.users[userId] = user;
    }

    // ユーザー情報更新
    user.lineDisplayName = lineDisplayName;
    user.discordDisplayName = displayName;

    // --- テキストによる明示的な状態指定 ---
    if (type === 'TEXT_OFF') {
      user.state = 'OFF';
      user.count = 0;
      user.startedAt = 0;
      this._save();
      return { action: 'OFF', displayName };
    }

    if (type.startsWith('TEXT_')) {
      const newState = type.replace('TEXT_', 'ON_');
      
      // すでにその状態で、なおかつ1時間以内なら何もしない（あるいはカウントリセット等）
      // 今回は純粋に状態を上書きし、タイマーをリセットする
      user.state = newState;
      user.count = 1;
      user.startedAt = now;
      this._save();
      return { action: newState, displayName };
    }

    // --- スタンプによる状態遷移（従来互換） ---
    if (type === 'STAMP') {
      if (user.state === 'OFF') {
        user.state = 'ON_ANY';
        user.count = 1;
        user.startedAt = now;
        this._save();
        return { action: 'ON_ANY', displayName };
      }

      // 1時間ウィンドウ外なら、状態リセットしてON_ANYにする
      const elapsed = now - user.startedAt;
      if (elapsed > windowMs) {
        user.state = 'ON_ANY';
        user.count = 1;
        user.startedAt = now;
        this._save();
        return { action: 'ON_ANY', displayName };
      }

      // 1時間ウィンドウ内
      user.count += 1;
      let action = 'NONE';

      if (user.count === 2) {
        // 2回目で通知
        user.state = 'ON_NOTIFIED';
        action = 'NOTIFY';
      } else if (user.count === 3) {
        // 3回目は変化なし
        action = 'NONE';
      } else {
        // 4回目でOFF
        user.state = 'OFF';
        user.count = 0;
        user.startedAt = 0;
        action = 'OFF';
      }

      this._save();
      return { action, displayName };
    }

    return { action: 'NONE', displayName };
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
