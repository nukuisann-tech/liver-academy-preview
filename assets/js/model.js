/* model.js — 学習記録の読み書きと、「次に何を出すか」の決め方。
 * 保存先には触らない（LEAStore だけを使う）。画面の部品も持たない。
 * 内容データは window.LEA_DATA（build.py が作る site-data.js）。 */
(function (global) {
  'use strict';
  var S = global.LEAStore;
  var D = global.LEA_DATA || { lessons: {}, chapters: [], levels: [], fastTrack: { before: [], after: [], delayed: [] }, cards: [], tracks: [] };

  var DEFAULT_SETTINGS = {
    entryType: null, startChapter: null, performer: false, firstLiveDone: false,
    firstLiveDate: null, baselineStage: 'B0', todayLive: null, dismissed: []
  };

  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2);
  }
  function values(list) { return list.map(function (x) { return x.value; }); }

  var M = {
    data: D,
    today: today,

    /* ---------- 設定 ---------- */
    settings: function () {
      return S.get('settings', {}).then(function (s) {
        var out = {};
        Object.keys(DEFAULT_SETTINGS).forEach(function (k) { out[k] = (s && s[k] !== undefined) ? s[k] : DEFAULT_SETTINGS[k]; });
        return out;
      });
    },
    saveSettings: function (patch) {
      return M.settings().then(function (s) {
        Object.keys(patch).forEach(function (k) { s[k] = patch[k]; });
        return S.set('settings', s);
      });
    },

    /* ---------- Lesson の進み ---------- */
    lessonRecords: function () {
      return S.list('lesson/').then(function (list) {
        var map = {};
        values(list).forEach(function (r) { if (r && r.id) { map[r.id] = r; } });
        return map;
      });
    },
    markRead: function (id, note) {
      return S.get('lesson/' + id).then(function (r) {
        r = r || { id: id, state: 'read', readAt: new Date().toISOString(), confirmedAt: null, note: null };
        if (note !== undefined) { r.note = note || null; }
        return S.set('lesson/' + id, r);
      });
    },
    markConfirmed: function (id) {
      return S.get('lesson/' + id).then(function (r) {
        var now = new Date().toISOString();
        r = r || { id: id, state: 'read', readAt: now, confirmedAt: null, note: null };
        r.state = 'confirmed';
        r.confirmedAt = r.confirmedAt || now;
        return S.set('lesson/' + id, r);
      });
    },

    /* ---------- ONE FOCUS ---------- */
    focus: function () {
      return S.get('focus', null).then(function (f) {
        return { current: (f && f.current) || null, candidates: (f && f.candidates) || [] };
      });
    },
    makeFocusItem: function (lessonId, text, kind) {
      return { id: S.newId(), lessonId: lessonId || null, text: text, kind: kind || 'custom', startedAt: new Date().toISOString(), tries: 0 };
    },
    /* FOCUS にする。進行中があれば、replace が true のときだけ入れ替える。そうでなければ候補に入れる。 */
    setFocus: function (item, replace) {
      return M.focus().then(function (f) {
        var chain = Promise.resolve();
        f.candidates = f.candidates.filter(function (c) { return c.text !== item.text; });
        if (f.current && !replace) {
          if (f.current.text !== item.text) { f.candidates.push(item); }
          return S.set('focus', f).then(function () { return { placed: 'candidate', focus: f }; });
        }
        if (f.current && f.current.text !== item.text) { chain = M._archive(f.current, 'replaced'); }
        f.current = item;
        return chain.then(function () { return S.set('focus', f); }).then(function () { return { placed: 'current', focus: f }; });
      });
    },
    removeCandidate: function (id) {
      return M.focus().then(function (f) {
        f.candidates = f.candidates.filter(function (c) { return c.id !== id; });
        return S.set('focus', f);
      });
    },
    endFocus: function (outcome) {
      return M.focus().then(function (f) {
        if (!f.current) { return f; }
        var cur = f.current;
        f.current = null;
        return M._archive(cur, outcome).then(function () { return S.set('focus', f); });
      });
    },
    _archive: function (item, outcome) {
      var rec = JSON.parse(JSON.stringify(item));
      rec.endedAt = new Date().toISOString();
      rec.outcome = outcome;
      return S.set('focus-history/' + rec.id, rec);
    },
    focusHistory: function () { return S.list('focus-history/').then(values); },
    habits: function () { return S.list('habit/').then(values); },

    /* ---------- 配信前 ---------- */
    prelive: function () { return S.get('prelive', null); },
    startLive: function (bundles) {
      return M.focus().then(function (f) {
        var rec = { startedAt: new Date().toISOString(), bundles: bundles, focus: f.current };
        return S.set('prelive', rec);
      });
    },

    /* ---------- 配信ログ ---------- */
    logs: function () {
      return S.list('log/').then(function (list) {
        return values(list).filter(Boolean).sort(function (a, b) { return a.at < b.at ? -1 : 1; });
      });
    },
    /* 記録 1 回分を保存し、それに伴う更新（試した回数・証拠・Lesson の状態・初配信済み）をまとめて行う */
    saveLog: function (entry) {
      entry.id = S.newId();
      entry.at = new Date().toISOString();
      var lesson = entry.focus && entry.focus.lessonId ? D.lessons[entry.focus.lessonId] : null;
      var did = entry.q1 === 'できた' || entry.q1 === '一部できた';
      return S.set('log/' + entry.id, entry)
        .then(function () { return S.remove('prelive'); })
        .then(function () { return M.saveSettings({ firstLiveDone: true, todayLive: null }); })
        .then(function () { return M.focus(); })
        .then(function (f) {
          if (f.current && entry.focus && f.current.id === entry.focus.id) {
            f.current.tries = (f.current.tries || 0) + 1;
            if (entry.q4 === '小さく・少し変えて続ける' && entry.q4Text) { f.current.text = entry.q4Text; f.current.kind = 'custom'; }
            return S.set('focus', f);
          }
        })
        .then(function () {
          if (!entry.focus || !did) { return; }
          var ev = {
            id: S.newId(), at: entry.at, lessonId: entry.focus.lessonId || null,
            tracks: lesson ? lesson.tr : [], type: 'F', strength: 'E3', by: '本人',
            counts: lesson ? lesson.cm : null, text: entry.focus.text, logId: entry.id
          };
          return S.set('evidence/' + ev.id, ev).then(function () {
            if (entry.focus.lessonId) { return M.markConfirmed(entry.focus.lessonId); }
          });
        })
        .then(function () { return entry; });
    },
    evidence: function () {
      return S.list('evidence/').then(function (list) {
        return values(list).filter(Boolean).sort(function (a, b) { return a.at < b.at ? 1 : -1; });
      });
    },
    addNoteEvidence: function (lessonId, text) {
      var lesson = D.lessons[lessonId];
      var key = 'evidence/note-' + lessonId;
      var ev = { id: 'note-' + lessonId, at: new Date().toISOString(), lessonId: lessonId, tracks: lesson ? lesson.tr : [],
        type: 'R', strength: 'E1', by: '本人', counts: lesson ? lesson.cm : null, text: text, logId: null };
      return S.set(key, ev);
    },

    /* ---------- 区切りの振り返り ---------- */
    reviews: function () { return S.list('review/').then(values); },
    saveReview: function (rev) {
      rev.id = S.newId();
      rev.at = new Date().toISOString();
      return M.focus().then(function (f) {
        var cur = f.current;
        rev.focusId = cur ? cur.id : null;
        var chain = S.set('review/' + rev.id, rev);
        if (cur && rev.q1 === '意識しなくてもできる') {
          chain = chain.then(function () {
            return S.set('habit/' + cur.id, { id: cur.id, text: cur.text, lessonId: cur.lessonId, since: rev.at });
          }).then(function () { return M.endFocus('habit'); });
        } else if (cur && rev.q1 === '合っていないのでやめる') {
          chain = chain.then(function () { return M.endFocus('stopped'); });
        }
        return chain.then(function () { return rev; });
      });
    },

    /* ---------- 歩く順 ---------- */
    /* 章の並び（lessons 配列の順）。後に回した Lesson・読むだけ・分岐（設定していない人）は外す */
    walkOrder: function (settings) {
      var out = [];
      var started = !settings.startChapter;
      var delayed = D.fastTrack.delayed;
      D.chapters.forEach(function (ch) {
        if (ch.id === settings.startChapter) { started = true; }
        if (!started || ch.branch) { return; }
        ch.lessons.forEach(function (id) {
          var l = D.lessons[id];
          var walked = l.p !== 'ref' && delayed.indexOf(id) < 0;
          if (walked) { out.push(id); }
          /* 分岐は、係留先の Lesson が歩く順に入っているときだけ、その直後に差し込む */
          if (walked && settings.performer) {
            Object.keys(D.lessons).forEach(function (bid) {
              if (D.lessons[bid].ba === id && out.indexOf(bid) < 0) { out.push(bid); }
            });
          }
        });
      });
      return out;
    },
    nextLesson: function (settings, records) {
      var order = M.walkOrder(settings);
      for (var i = 0; i < order.length; i++) { if (!records[order[i]]) { return order[i]; } }
      return null;
    },
    /* 初配信までの道の、次の 1 歩。全部済んでいれば { last: true } */
    fastTrackNext: function (settings, records) {
      var steps = D.fastTrack.before.filter(function (s) { return !s.onlyFor || settings.performer; });
      for (var i = 0; i < steps.length; i++) {
        var s = steps[i];
        var done = s.lesson === 'C00-L02' ? !!settings.entryType || !!records[s.lesson] : !!records[s.lesson];
        if (i === steps.length - 1) { return { step: s, next: null, last: true }; }
        if (!done) { return { step: s, next: steps[i + 1] || null, last: false }; }
      }
      return null;
    },
    /* きっかけが来た Lesson（最大 1 本。並び順で先のもの） */
    triggered: function (settings, records, logs) {
      function fired(t) {
        if (!t) { return false; }
        var parts = t.split(':');
        if (t === 'live1' || t === 'log1') { return logs.length >= 1; }
        if (t === 'card1') { return logs.some(function (l) { return l.q3 && l.q3 !== 'skip'; }); }
        if (t === 'live2') { return logs.length >= 1; }
        if (t === 'return1') { return logs.some(function (l) { return l.returning === 'いた'; }); }
        if (t === 'first_review') { return logs.length >= 2; }
        if (parts[0] === 'pick') { return logs.some(function (l) { return String(l.q3) === parts[1]; }); }
        if (parts[0] === 'after') { return !!records[parts[1]]; }
        if (parts[0] === 'enter') {
          var ch = D.chapters.filter(function (c) { return c.id === parts[1]; })[0];
          return !!ch && ch.lessons.some(function (id) { return !!records[id]; });
        }
        return false;
      }
      var list = D.fastTrack.after;
      for (var i = 0; i < list.length; i++) {
        var a = list[i];
        if (a.onlyFor && !settings.performer) { continue; }
        if (records[a.lesson] || settings.dismissed.indexOf(a.lesson) >= 0) { continue; }
        if (fired(a.trigger) || fired(a.latest)) { return a; }
      }
      return null;
    },
    triggerText: function (t) {
      if (!t) { return ''; }
      if (D.triggerText[t]) { return D.triggerText[t]; }
      var parts = t.split(':');
      if (parts[0] === 'pick') {
        var c = D.cards.filter(function (x) { return String(x.id) === parts[1]; })[0];
        return '配信後の記録で「' + (c ? c.text : parts[1]) + '」を選んだため';
      }
      if (parts[0] === 'after' && D.lessons[parts[1]]) { return '「' + D.lessons[parts[1]].t + '」を終えたため'; }
      if (parts[0] === 'enter') { return parts[1] + ' に着いたため'; }
      return t;
    },
    chapterOf: function (lessonId) {
      var l = D.lessons[lessonId];
      if (!l) { return null; }
      return D.chapters.filter(function (c) { return c.id === l.c; })[0] || null;
    },
    levelName: function (levelId) {
      var lv = D.levels.filter(function (x) { return x.id === levelId; })[0];
      return lv ? lv.name + '（' + lv.id + '）' : levelId;
    }
  };

  global.LEAModel = M;
})(window);
