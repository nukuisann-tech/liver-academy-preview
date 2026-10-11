/* store.js — 学習記録の保存口（ここだけが保存先を知っている）。
 *
 * ほかの JS は localStorage を直接触らない。必ず LEAStore を通す。
 * 将来 Database・API・ログインに載せ替えるときは、下の「アダプタ」を
 * 同じ 6 つの関数（get / set / list / remove / export / clear）を持つ別物に差し替える。
 * すべて Promise を返すので、通信を挟む実装にもそのまま替えられる。
 *
 * ======================================================================
 * 学習記録のデータ構造  版: 1  （SCHEMA_VERSION）
 * ======================================================================
 * 1 件 = 1 キー。キーは「種類/ID」。将来は種類ごとに 1 つの表になる。
 * 日時はすべて ISO 8601 の文字列。Lesson は内容データの ID（例 "C05-L02"）で指す。
 *
 * meta                 { schema: 1, createdAt }
 *
 * settings             { entryType: "A"|"B"|"C"|"D"|null,   入口診断で選んだタイプ
 *                        startChapter: "C04"|null,            勧められた開始章
 *                        performer: boolean,                  表現者として設定したか（分岐 C12 を出す）
 *                        firstLiveDone: boolean,              初配信が済んだか
 *                        firstLiveDate: "YYYY-MM-DD"|null,    本人が置いた初配信の日（任意）
 *                        baselineStage: "B0"|"B1"|"B2"|"B3",  BASELINE CHECK をどの段まで出すか
 *                        todayLive: "YYYY-MM-DD"|null,        「今日配信する」を押した日
 *                        dismissed: [lessonId] }              「いまはやらない」にした、きっかけの Lesson
 *
 * focus                { current: FocusItem|null,             進行中の ONE FOCUS（1 つだけ）
 *                        candidates: [FocusItem] }            FOCUS の候補（待ち行列）
 *   FocusItem          { id, lessonId|null, text,
 *                        kind: "written"|"proposal"|"provisional"|"custom",
 *                          written = 内容データの確定した 1 文 / proposal = 専門家の提案（下書き）
 *                          provisional = 到達目標を使った仮の文 / custom = 本人が書いた文
 *                        startedAt, tries: number }           tries = 試した配信の回数（事実）
 *
 * focus-history/<id>   FocusItem + { endedAt, outcome: "habit"|"stopped"|"replaced" }
 *
 * habit/<id>           { id, text, lessonId|null, since }     「いつものこと」（FOCUS から移った行動）
 *
 * prelive              { startedAt, bundles: { safety, av, flow: boolean },   配信前の確認 1 回分
 *                        focus: FocusItem|null } | null       「配信を始める」を押してから記録するまで残る
 *
 * log/<id>             { id, at, startedAt|null,              配信ログ（Mini Review）1 回分
 *                        focus: { id, lessonId, text, kind }|null,
 *                        returning: "いた"|"いなかった"|"分からない"|null,     冒頭の 1 問
 *                        q1: "できた"|"一部できた"|"できなかった"|"やれた"|"途中でやめた",
 *                        q1Reason: string|null,               できなかった理由（1 つ）
 *                        q2: string|null,                     何が起きた（選択肢の文）
 *                        q3: 1|2|3|4|5|"skip",                いちばん困った所（症状カードの ID）
 *                        q4: "続ける"|"小さく・少し変えて続ける"|"別の 1 つ",
 *                        q4Text: string|null,                 小さく・少し変えた文
 *                        baseline: { safety, av, flow }|null, 配信前に確認した束
 *                        baselineMiss: { answer: "なかった"|"あった", lines: [1..4] }|null,
 *                        good: string|null,                   良かったこと 1 行
 *                        numbers: { 名前: 数値 },             任意の数字（空でよい）
 *                        kind: "通常"|"バトル"|"イベント"|"コラボ" }
 *
 * lesson/<lessonId>    { id, state: "read"|"confirmed",       Lesson の進み（「試している」は focus から求める）
 *                        readAt, confirmedAt|null, note: string|null }   note = 自分の言葉の 1 行
 *
 * evidence/<id>        { id, at, lessonId|null, tracks: [トラック ID],
 *                        type: "K"|"A"|"F"|"R",               証拠の種類（内容データ tracks.json の evidence_types）
 *                        strength: "E1"|"E2"|"E3",            証拠の強さ
 *                        by: "本人",                          誰が確かめたか（初版は本人だけ）
 *                        counts: boolean|null,                習熟の段に数える Lesson か
 *                        text, logId|null }
 *                      ※ M 段は保存しない。証拠と、その時点の Rule から毎回求める。
 *
 * review/<id>          { id, at, focusId|null,                区切りの振り返り 1 回分
 *                        q1: "意識しなくてもできる"|"まだ続ける"|"小さくする"|"合っていないのでやめる",
 *                        q2: 1..5|null, rest: boolean, fatigue: [string] }
 * ====================================================================== */
(function (global) {
  'use strict';

  var SCHEMA_VERSION = 1;
  var NAMESPACE = 'lea.v1.';

  /* ---- アダプタ: localStorage 版。載せ替えるのはここだけ ---- */
  function localAdapter() {
    var ls;
    var memory = {};
    try {
      ls = global.localStorage;
      ls.setItem(NAMESPACE + '__probe', '1');
      ls.removeItem(NAMESPACE + '__probe');
    } catch (e) {
      ls = null; /* 保存できない環境では、ページを開いている間だけ覚える */
    }
    function keys() {
      var out = [];
      if (!ls) { return Object.keys(memory); }
      for (var i = 0; i < ls.length; i++) {
        var k = ls.key(i);
        if (k && k.indexOf(NAMESPACE) === 0) { out.push(k.slice(NAMESPACE.length)); }
      }
      return out;
    }
    return {
      persistent: !!ls,
      read: function (key) {
        var raw = ls ? ls.getItem(NAMESPACE + key) : memory[key];
        if (raw === null || raw === undefined) { return undefined; }
        try { return JSON.parse(raw); } catch (e) { return undefined; }
      },
      write: function (key, value) {
        var raw = JSON.stringify(value);
        if (ls) { ls.setItem(NAMESPACE + key, raw); } else { memory[key] = raw; }
      },
      erase: function (key) {
        if (ls) { ls.removeItem(NAMESPACE + key); } else { delete memory[key]; }
      },
      keys: keys
    };
  }

  var adapter = localAdapter();

  function ensureMeta() {
    if (adapter.read('meta') === undefined) {
      adapter.write('meta', { schema: SCHEMA_VERSION, createdAt: new Date().toISOString() });
    }
  }

  var LEAStore = {
    SCHEMA_VERSION: SCHEMA_VERSION,
    persistent: adapter.persistent,

    /* 1 件読む。無ければ fallback（省略時 null） */
    get: function (key, fallback) {
      var v = adapter.read(key);
      return Promise.resolve(v === undefined ? (fallback === undefined ? null : fallback) : v);
    },
    /* 1 件書く */
    set: function (key, value) {
      ensureMeta();
      adapter.write(key, value);
      return Promise.resolve(value);
    },
    /* 「種類/」で始まるものを全部読む。[{ key, value }] */
    list: function (prefix) {
      var out = [];
      adapter.keys().forEach(function (k) {
        if (k.indexOf(prefix) === 0) { out.push({ key: k, value: adapter.read(k) }); }
      });
      out.sort(function (a, b) { return a.key < b.key ? -1 : (a.key > b.key ? 1 : 0); });
      return Promise.resolve(out);
    },
    /* 1 件消す */
    remove: function (key) {
      adapter.erase(key);
      return Promise.resolve();
    },
    /* 全記録を 1 つの入れ物にして返す（書き出し用） */
    export: function () {
      var records = {};
      adapter.keys().forEach(function (k) { records[k] = adapter.read(k); });
      return Promise.resolve({
        app: 'liver-elite-learning-site',
        schema: SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        records: records
      });
    },
    /* 書き出したものを読み戻す（同じ版だけ） */
    import: function (dump) {
      if (!dump || dump.schema !== SCHEMA_VERSION || typeof dump.records !== 'object') {
        return Promise.reject(new Error('この版では読み込めないデータです'));
      }
      Object.keys(dump.records).forEach(function (k) { adapter.write(k, dump.records[k]); });
      return Promise.resolve();
    },
    /* 全部消す */
    clear: function () {
      adapter.keys().forEach(function (k) { adapter.erase(k); });
      return Promise.resolve();
    },
    /* 新しい ID（時刻順に並ぶ） */
    newId: function () {
      return new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 17) + Math.random().toString(36).slice(2, 6);
    }
  };

  global.LEAStore = LEAStore;
})(window);
