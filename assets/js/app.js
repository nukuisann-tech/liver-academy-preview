/* app.js — 画面ごとの動き。
 * 記録の読み書きは LEAModel（model.js）→ LEAStore（store.js）を通す。ここでは保存先に直接触らない。
 * 本文は HTML に入っている。ここがするのは、記録にもとづく出し分けと入力の保存だけ。 */
(function () {
  'use strict';
  var M = window.LEAModel;
  var D = M.data;
  var body = document.body;
  var root = body.getAttribute('data-root') || '';
  var pageKey = body.getAttribute('data-page');

  /* ---------- 小さな道具 ---------- */
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === 'class') { el.className = attrs[k]; }
      else if (k === 'text') { el.textContent = attrs[k]; }
      else if (k === 'onclick') { el.addEventListener('click', attrs[k]); }
      else if (attrs[k] !== null && attrs[k] !== undefined && attrs[k] !== false) { el.setAttribute(k, attrs[k]); }
    });
    (kids || []).forEach(function (kid) {
      if (kid === null || kid === undefined || kid === false) { return; }
      el.appendChild(typeof kid === 'string' ? document.createTextNode(kid) : kid);
    });
    return el;
  }
  function fill(el, kids) {
    if (!el) { return; }
    while (el.firstChild) { el.removeChild(el.firstChild); }
    (kids || []).forEach(function (k) { if (k) { el.appendChild(typeof k === 'string' ? document.createTextNode(k) : k); } });
  }
  function lessonHref(id) { return root + 'lessons/' + id + '.html'; }
  function lessonTitle(id) { return D.lessons[id] ? D.lessons[id].t : id; }
  function md(iso) { var d = new Date(iso); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function checked(name) { var el = $('input[name="' + name + '"]:checked'); return el ? el.value : null; }
  function kindLabel(kind) {
    return { written: '', proposal: '専門家の提案（下書き・実データ未検証）', provisional: '仮の文（準備中）', custom: '自分で書いた文' }[kind] || '';
  }
  function focusLine(item) {
    var kids = [h('p', { class: 'focus-text', text: item.text })];
    var label = kindLabel(item.kind);
    if (label) { kids.unshift(h('p', {}, [h('span', { class: 'badge badge--prep', text: label })])); }
    return kids;
  }

  /* ---------- 全ページ共通: 設定と記録にもとづく出し分け ---------- */
  function applyCommon(ctx) {
    $all('[data-only-for="performer"]').forEach(function (el) { el.hidden = !ctx.settings.performer; });
    $all('[data-only-for="not-performer"]').forEach(function (el) { el.hidden = !!ctx.settings.performer; });
    var cur = ctx.focus.current;
    $all('li[data-lesson]').forEach(function (li) {
      var id = li.getAttribute('data-lesson');
      var rec = ctx.records[id];
      if (cur && cur.lessonId === id) { li.classList.add('is-trying', 'is-here'); }
      else if (rec && rec.state === 'confirmed') { li.classList.add('is-confirmed'); }
      else if (rec) { li.classList.add('is-read'); }
    });
  }

  function load() {
    return Promise.all([M.settings(), M.lessonRecords(), M.focus(), M.logs(), M.prelive()]).then(function (r) {
      return { settings: r[0], records: r[1], focus: r[2], logs: r[3], prelive: r[4] };
    });
  }

  /* ---------- ホーム ---------- */
  function initHome(ctx) {
    var s = ctx.settings, cur = ctx.focus.current;
    var beforeFirst = !s.firstLiveDone && ctx.logs.length === 0;
    var ftn = beforeFirst ? M.fastTrackNext(s, ctx.records) : null;
    var next = M.nextLesson(s, ctx.records);
    var where = [];

    if (ftn) {
      where.push(h('p', {}, [h('a', { href: 'map.html#fast-track' }, ['いま: 初配信までの道・「' + ftn.step.label + '」'])]));
      if (s.firstLiveDate) { where.push(h('p', { class: 'small muted', text: '初配信の日: ' + s.firstLiveDate })); }
    } else {
      var anchor = (cur && cur.lessonId) || next;
      var ch = anchor ? M.chapterOf(anchor) : null;
      var line = ch ? 'いま: ' + M.levelName(D.lessons[anchor].lv) + '・' + ch.id + ' ' + ch.title : 'いま: 学習マップ';
      where.push(h('p', {}, [h('a', { href: 'map.html' }, [line])]));
      if (cur && cur.lessonId && D.lessons[cur.lessonId] && D.lessons[cur.lessonId].tr.length) {
        var tid = D.lessons[cur.lessonId].tr[0];
        var tr = D.tracks.filter(function (t) { return t.id === tid; })[0];
        where.push(h('p', { class: 'small muted', text: '伸ばしているスキル: ' + (tr ? tr.name : tid) }));
      }
    }
    fill($('#home-where'), where);

    var main = $('#home-main');
    var state;
    var pending = ctx.prelive && !ctx.prelive.snoozed;
    if (pending) {
      state = 1;
      fill(main, [
        h('p', { class: 'card__label', text: '配信おつかれさまでした' }),
        h('p', { text: 'さっきの配信の記録が、まだ残っています。' }),
        ctx.prelive.focus ? h('p', { class: 'focus-text', text: ctx.prelive.focus.text }) : null,
        h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary btn--block', href: 'postlive.html' }, ['4 つだけ記録する'])]),
        h('button', { type: 'button', class: 'linklike', text: 'あとで記録する', onclick: function () {
          ctx.prelive.snoozed = true;
          window.LEAStore.set('prelive', ctx.prelive).then(function () { initHome(ctx); });
        } })
      ]);
    } else if (ftn) {
      state = 2;
      var st = ftn.step;
      var isEntry = st.lesson === 'C00-L02';
      var kids = [h('p', { class: 'card__label', text: '次の 1 歩' }), h('p', { class: 'focus-text', text: st.label })];
      if (ftn.last) {
        kids.push(h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary btn--block', href: 'prelive.html' }, ['配信前の確認へ'])]));
        kids.push(h('p', { class: 'small' }, [h('a', { href: lessonHref(st.lesson) }, ['先に Lesson を読む: ' + lessonTitle(st.lesson)])]));
      } else {
        kids.push(h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary btn--block', href: isEntry ? 'start.html' : lessonHref(st.lesson) }, ['はじめる'])]));
        if (ftn.next) { kids.push(h('p', { class: 'small muted', text: 'その次: ' + ftn.next.label })); }
      }
      fill(main, kids);
    } else if (s.todayLive === M.today()) {
      state = 3;
      fill(main, [h('p', { class: 'card__label', text: '今日は配信の日' }), h('p', { class: 'small muted', text: "TODAY'S ONE FOCUS" })]
        .concat(cur ? focusLine(cur).concat([h('p', { class: 'small muted', text: 'これまでに試した配信: ' + (cur.tries || 0) + ' 回' })])
          : [h('p', { text: '今日は ONE FOCUS を決めていません。記録だけで十分です。' })])
        .concat([h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary btn--block', href: 'prelive.html' }, ['配信前の確認へ'])]),
          h('p', { class: 'small muted', text: '毎回の確認（BASELINE CHECK）は次の画面で' })]));
    } else if (!cur) {
      state = 4;
      fill(main, [
        h('p', { class: 'card__label', text: '次の配信の ONE FOCUS を決める' }),
        h('p', { text: '次の配信で試す 1 つが、まだ決まっていません。' }),
        h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary btn--block', href: 'focus.html' }, ['候補から選ぶ'])])
      ]);
    } else {
      state = 5;
      if (next) {
        fill(main, [
          h('p', { class: 'card__label', text: '次の Lesson' }),
          h('p', { class: 'focus-text', text: lessonTitle(next) }),
          h('p', { class: 'small muted', text: D.reasonTexts[2] }),
          h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary btn--block', href: lessonHref(next) }, ['Lesson を開く'])])
        ]);
      } else {
        fill(main, [h('p', { class: 'card__label', text: '次の Lesson' }), h('p', { text: '歩く順の Lesson は、ひととおり開きました。' }),
          h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary btn--block', href: 'map.html' }, ['学習マップを見る'])])]);
      }
    }

    var rows = [];
    if (state !== 1 && state !== 2) {
      var kids2 = [h('p', { class: 'card__label', text: '次の配信の ONE FOCUS' })];
      if (cur && state !== 3) {
        kids2.push(h('p', {}, [h('a', { href: 'focus.html' }, ['「' + cur.text + '」']), '　試した配信: ' + (cur.tries || 0) + ' 回']));
      }
      if (state !== 3) {
        kids2.push(h('button', { type: 'button', class: 'linklike', text: '今日配信する ▸', onclick: function () {
          M.saveSettings({ todayLive: M.today() }).then(function () { ctx.settings.todayLive = M.today(); initHome(ctx); });
        } }));
        rows.push(h('section', { class: 'card card--sub' }, kids2));
      }
    }
    if (ctx.prelive && ctx.prelive.snoozed) {
      rows.push(h('section', { class: 'card card--sub' }, [h('p', {}, ['記録していない配信があります。', h('a', { href: 'postlive.html' }, ['4 つだけ記録する'])])]));
    }
    if (state !== 1 && s.firstLiveDone) {
      var trig = M.triggered(s, ctx.records, ctx.logs);
      if (trig) {
        rows.push(h('section', { class: 'card card--sub' }, [
          h('p', { class: 'card__label', text: 'いまのあなたに関係がある 1 本' }),
          h('p', {}, [h('a', { href: lessonHref(trig.lesson) }, ['「' + lessonTitle(trig.lesson) + '」'])]),
          h('p', { class: 'small muted', text: M.triggerText(trig.trigger) }),
          h('button', { type: 'button', class: 'linklike', text: 'いまはやらない', onclick: function () {
            s.dismissed.push(trig.lesson);
            M.saveSettings({ dismissed: s.dismissed }).then(function () { initHome(ctx); });
          } })
        ]));
      }
    }
    M.evidence().then(function (evs) {
      var f = evs.filter(function (e) { return e.type === 'F'; })[0];
      if (f) {
        rows.push(h('section', { class: 'card card--sub' }, [
          h('p', { class: 'card__label', text: '最近できるようになったこと' }),
          h('p', {}, [h('a', { href: 'skills.html#evidence-history' }, [md(f.at) + '　「' + f.text + '」を本番でやった（自己申告）'])])
        ]));
      }
      if (state >= 3 && state <= 4 && next) {
        rows.push(h('section', { class: 'card card--sub' }, [h('p', {}, ['次の Lesson: ', h('a', { href: lessonHref(next) }, ['「' + lessonTitle(next) + '」'])])]));
      }
      fill($('#home-rows'), rows);
    });
  }

  /* ---------- 入口診断 ---------- */
  function initStart(ctx) {
    var form = $('#entry-form');
    var s = ctx.settings;
    if (s.entryType) { var a = $('input[name="entry-type"][value="' + s.entryType + '"]'); if (a) { a.checked = true; } }
    var p = $('input[name="entry-performer"][value="' + (s.performer ? 'yes' : 'no') + '"]');
    if (p && s.entryType) { p.checked = true; }
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var type = checked('entry-type');
      var box = $('#entry-result');
      if (!type) { box.hidden = false; fill(box, [h('p', { text: '1 の答えを選んでください。' })]); return; }
      var patch = { entryType: type, performer: checked('entry-performer') === 'yes', startChapter: D.entryStart[type] };
      if (type !== 'A') { patch.firstLiveDone = true; }
      M.saveSettings(patch).then(function () { return M.markRead('C00-L02'); }).then(function () {
        var href = type === 'A' ? 'map.html#fast-track' : 'chapters/' + D.entryStart[type] + '.html';
        var text = type === 'A' ? '「初配信までの道」から始めます。' :
          D.entryStart[type] + ' から始めます。配信の前には「配信前の確認」、後には「配信後の記録」を使います。';
        box.hidden = false;
        fill(box, [h('p', { class: 'card__label', text: '始める場所' }), h('p', { text: text }),
          h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary', href: href }, ['ここから始める']),
            type !== 'A' ? h('a', { class: 'btn', href: 'focus.html' }, ['次の配信で試す 1 つを選ぶ']) : null]),
          h('p', { class: 'small' }, [h('a', { href: 'index.html' }, ['ホームへ'])])]);
        box.scrollIntoView();
      });
    });
  }

  /* ---------- 学習マップ ---------- */
  function initMap(ctx) {
    var s = ctx.settings;
    var beforeFirst = !s.firstLiveDone && ctx.logs.length === 0;
    var ftn = beforeFirst ? M.fastTrackNext(s, ctx.records) : null;
    $all('[data-ft-step]').forEach(function (li) {
      var id = li.getAttribute('data-ft-step');
      var done = !beforeFirst || (id === 'C00-L02' ? !!s.entryType : !!ctx.records[id]);
      if (id === '__log__') { done = ctx.logs.length > 0; }
      var mark = $('[data-ft-state]', li);
      if (ftn && ftn.step.lesson === id) { li.classList.add('is-here'); if (mark) { mark.textContent = '← いまここ'; } }
      else if (done && id !== '__log__' || (id === '__log__' && done)) { li.classList.add('is-done'); if (mark) { mark.textContent = '済'; } }
    });
    if (!beforeFirst) {
      $('#ft-done-note').hidden = false;
      var whole = $('#whole-map'), ft = $('#fast-track'), after = $('#after-first-live');
      whole.parentNode.insertBefore(whole, ft);
      whole.parentNode.insertBefore(after, ft);
      after.open = true;
      ft.classList.remove('card--main');
    }
    var cur = ctx.focus.current;
    var here = (cur && cur.lessonId) || (!beforeFirst ? M.nextLesson(s, ctx.records) : null);
    if (here && D.lessons[here]) {
      var card = $('[data-chapter="' + D.lessons[here].c + '"]');
      if (card) { card.appendChild(h('span', { class: 'badge badge--here', text: 'いまここ' })); }
    }
  }

  /* ---------- Lesson ---------- */
  function initLesson(ctx) {
    var id = body.getAttribute('data-lesson');
    var cur = ctx.focus.current;
    function renderState() {
      return M.lessonRecords().then(function (records) {
        var rec = records[id];
        var word = 'まだ';
        if (cur && cur.lessonId === id) { word = '試している（いまの ONE FOCUS）'; }
        else if (rec && rec.state === 'confirmed') { word = '本番で確認した'; }
        else if (rec) { word = '読んだ'; }
        fill($('#lesson-state'), [h('p', { class: 'small' }, ['この Lesson の状態: ', h('span', { class: 'badge', text: word })])]);
        if (rec && rec.note && !$('#note-input').value) { $('#note-input').value = rec.note; }
      });
    }
    renderState();
    var readBtn = $('[data-act="lesson-read"]');
    if (readBtn) {
      readBtn.addEventListener('click', function () {
        var note = $('#note-input').value.trim();
        M.markRead(id, note).then(function () {
          if (note) { return M.addNoteEvidence(id, note); }
        }).then(function () {
          $('#note-msg').textContent = note ? '読んだ印と、自分の言葉の 1 行を残しました。' : '読んだ印を付けました。';
          renderState();
        });
      });
    }
    var box = $('#focus-actions');
    if (box) {
      var msg = $('#focus-msg');
      var btn = $('[data-act="focus-set"]', box);
      var item = function () { return M.makeFocusItem(id, box.getAttribute('data-text'), box.getAttribute('data-kind')); };
      if (cur && cur.lessonId === id) { btn.textContent = 'いまの ONE FOCUS です'; btn.disabled = true; btn.classList.add('is-on'); }
      btn.addEventListener('click', function () {
        M.setFocus(item(), false).then(function (res) {
          return M.markRead(id).then(function () { return res; });
        }).then(function (res) {
          if (res.placed === 'current') {
            cur = res.focus.current;
            btn.textContent = 'いまの ONE FOCUS です'; btn.disabled = true; btn.classList.add('is-on');
            fill(msg, ['今の ONE FOCUS にしました。配信前の確認に出ます。', h('a', { href: root + 'prelive.html' }, ['配信前の確認へ'])]);
          } else {
            fill(msg, ['進行中の ONE FOCUS「' + res.focus.current.text + '」があるので、候補に入れました。',
              h('button', { type: 'button', class: 'linklike', text: 'いまの FOCUS と入れ替える', onclick: function () {
                M.setFocus(item(), true).then(function (r2) {
                  cur = r2.focus.current;
                  btn.textContent = 'いまの ONE FOCUS です'; btn.disabled = true; btn.classList.add('is-on');
                  fill(msg, ['入れ替えました。前の FOCUS は「試したこと」に残っています。']);
                  renderState();
                });
              } })]);
          }
          renderState();
        });
      });
    }
  }

  /* ---------- ONE FOCUS の候補 ---------- */
  function initFocus() {
    function render() {
      return Promise.all([M.focus(), M.focusHistory()]).then(function (r) {
        var f = r[0], hist = r[1], cur = f.current;
        var kids = [h('h2', { text: 'いまの ONE FOCUS' })];
        if (cur) {
          kids = kids.concat(focusLine(cur));
          kids.push(h('p', { class: 'small muted', text: 'これまでに試した配信: ' + (cur.tries || 0) + ' 回' }));
          if (cur.lessonId) { kids.push(h('p', { class: 'small' }, ['Lesson: ', h('a', { href: lessonHref(cur.lessonId) }, [lessonTitle(cur.lessonId)])])); }
          var input = h('input', { type: 'text', id: 'focus-edit', maxlength: '120', value: cur.text });
          kids.push(h('div', { class: 'field' }, [h('label', { for: 'focus-edit', text: '自分の言葉に直す' }), input]));
          kids.push(h('div', { class: 'btn-row' }, [
            h('button', { type: 'button', class: 'btn', text: '文を直して保存', onclick: function () {
              var v = input.value.trim();
              if (!v) { return; }
              cur.text = v; cur.kind = 'custom';
              window.LEAStore.set('focus', f).then(render);
            } }),
            h('button', { type: 'button', class: 'btn btn--quiet', text: 'この FOCUS を終える', onclick: function () { M.endFocus('stopped').then(render); } })
          ]));
        } else {
          kids.push(h('p', { text: 'まだ決まっていません。下から 1 つ選ぶか、自分の言葉で決めます。' }));
        }
        fill($('#focus-current'), kids);

        var cbox = $('#focus-candidates');
        cbox.hidden = !f.candidates.length;
        fill(cbox, [h('h2', { text: '候補に入れたもの' }), h('ul', { class: 'list' }, f.candidates.map(function (c) {
          return h('li', {}, [h('div', { class: 'list__link' }, [h('span', { class: 'list__title', text: c.text }),
            h('span', { class: 'btn-row' }, [
              h('button', { type: 'button', class: 'btn', text: 'これを FOCUS にする', onclick: function () { M.setFocus(c, true).then(render); } }),
              h('button', { type: 'button', class: 'btn btn--quiet', text: '候補から外す', onclick: function () { M.removeCandidate(c.id).then(render); } })])])]);
        }))]);

        var hbox = $('#focus-history');
        if (hist.length) {
          var words = { habit: '「いつものこと」に移った', stopped: '終えた', replaced: '別の 1 つに替えた' };
          fill(hbox, [h('h2', { text: '試したこと' }), h('ul', {}, hist.map(function (x) {
            return h('li', { text: md(x.startedAt) + '〜' + md(x.endedAt) + '　「' + x.text + '」　試した配信: ' + (x.tries || 0) + ' 回　' + (words[x.outcome] || '') });
          }))]);
        }
      });
    }
    function pick(item) {
      M.focus().then(function (f) {
        var replace = true;
        if (f.current && f.current.text !== item.text) {
          replace = window.confirm('いまの ONE FOCUS「' + f.current.text + '」と入れ替えますか？\n（キャンセルを押すと、候補に入れます）');
        }
        return M.setFocus(item, replace);
      }).then(render).then(function () { $('#focus-current').scrollIntoView(); });
    }
    $all('[data-act="focus-pick"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        pick(M.makeFocusItem(btn.getAttribute('data-lesson'), btn.getAttribute('data-text'), btn.getAttribute('data-kind')));
      });
    });
    $('[data-act="focus-custom"]').addEventListener('click', function () {
      var v = $('#focus-custom').value.trim();
      if (v) { pick(M.makeFocusItem(null, v, 'custom')); $('#focus-custom').value = ''; }
    });
    render();
  }

  /* ---------- 配信前 ---------- */
  function initPrelive(ctx) {
    var s = ctx.settings, cur = ctx.focus.current;
    var stageIdx = D.stages.indexOf(s.baselineStage);
    $all('li[data-stage]').forEach(function (li) {
      var st = li.getAttribute('data-stage');
      if (st !== 'performer' && D.stages.indexOf(st) > stageIdx) { li.hidden = true; }
    });
    var bundles = { safety: false, av: false, flow: false };
    $all('[data-act="bundle-check"]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var id = btn.getAttribute('data-bundle');
        bundles[id] = !bundles[id];
        btn.setAttribute('aria-pressed', bundles[id] ? 'true' : 'false');
        btn.textContent = bundles[id] ? '確認した ✓' : '確認した';
        btn.closest('.bundle').classList.toggle('is-checked', bundles[id]);
        $('#baseline-done').hidden = !(bundles.safety && bundles.av && bundles.flow);
      });
    });
    M.habits().then(function (list) {
      if (list.length) { fill($('#habit-list'), list.map(function (x) { return h('li', { text: x.text }); })); }
    });
    var kids = [];
    var rehearsal = null;
    if (!s.firstLiveDone) {
      rehearsal = h('input', { type: 'checkbox', id: 'rehearsal' });
      kids.push(h('div', { class: 'checkline' }, [rehearsal, h('label', { for: 'rehearsal', text: 'これは予行（公開しない練習）です。配信後の記録は残しません' })]));
    }
    if (cur) {
      kids.push(h('p', { class: 'small muted', text: 'これまでに試した配信: ' + (cur.tries || 0) + ' 回' }));
      kids = kids.concat(focusLine(cur));
    } else {
      kids.push(h('p', { text: '今日は ONE FOCUS を決めていません。記録だけで十分です。' }));
      kids.push(h('p', { class: 'small' }, [h('a', { href: 'focus.html' }, ['候補から 1 つ選ぶ'])]));
    }
    fill($('#prelive-focus'), kids);
    $('[data-act="live-start"]').addEventListener('click', function () {
      var box = $('#prelive-started');
      if (rehearsal && rehearsal.checked) {
        box.hidden = false;
        fill(box, ['予行おつかれさまでした。予行は記録に残しません。本番の日に、もう一度ここから始めます。']);
        return;
      }
      M.startLive(bundles).then(function () {
        box.hidden = false;
        box.scrollIntoView();
      });
    });
  }

  /* ---------- 配信後 ---------- */
  function cardText(id) {
    var c = D.cards.filter(function (x) { return String(x.id) === String(id); })[0];
    return c ? c.text : '';
  }
  function initPostlive(ctx) {
    var form = $('#log-form');
    var fcs = (ctx.prelive && ctx.prelive.focus) || ctx.focus.current;
    var lesson = fcs && fcs.lessonId ? D.lessons[fcs.lessonId] : null;
    if (ctx.logs.length >= 1) { $('#q0').hidden = false; }
    if (fcs) {
      var q1f = $('#q1-focus'); q1f.hidden = false; q1f.textContent = fcs.text;
      $('#q2-obs').textContent = lesson && lesson.o ? 'この ONE FOCUS で見る所: ' + lesson.o : 'この ONE FOCUS の「見る所」は準備中です。手ごたえで選んでください。';
    } else {
      $('#q1-nofocus').hidden = false;
      $('#q1-legend').textContent = '今日の配信は最後までやれた？';
      var inputs = $all('input[name="q1"]');
      var spans = $all('#q1-choices span');
      inputs[0].value = 'やれた'; spans[0].textContent = 'やれた';
      inputs[1].value = '途中でやめた'; spans[1].textContent = '途中でやめた';
      inputs[2].closest('label').hidden = true;
      $('#q2').hidden = true;
      $all('input[name="q2"]').forEach(function (i) { i.required = false; });
      $('#q4-legend').textContent = '次の配信で 1 つ試すなら';
      $all('input[name="q4"]').forEach(function (i) { i.closest('label').hidden = i.value !== '別の 1 つ'; i.checked = i.value === '別の 1 つ'; });
    }
    form.addEventListener('change', function () {
      $('#q1-reason').hidden = checked('q1') !== 'できなかった';
      var small = checked('q4') === '小さく・少し変えて続ける';
      $('#q4-edit').hidden = !small;
      if (small && !$('#q4-text').value && fcs) { $('#q4-text').value = fcs.text; }
    });

    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var err = $('#log-error');
      var q1 = checked('q1'), q2 = checked('q2'), q3 = checked('q3'), q4 = checked('q4');
      if (!q1 || !q3 || (fcs && !q2)) { err.textContent = (fcs ? '1・2・3' : '1・3') + ' を選んでください（4 は「続ける」が選ばれています）。'; return; }
      err.textContent = '';
      var numbers = {};
      $all('input[name="num"]').forEach(function (i) { if (i.value.trim() !== '') { numbers[i.getAttribute('data-name')] = i.value.trim(); } });
      var missAns = checked('miss');
      var entry = {
        startedAt: ctx.prelive ? ctx.prelive.startedAt : null,
        focus: fcs ? { id: fcs.id, lessonId: fcs.lessonId, text: fcs.text, kind: fcs.kind } : null,
        returning: checked('q0'),
        q1: q1, q1Reason: q1 === 'できなかった' ? checked('q1reason') : null,
        q2: fcs ? q2 : null,
        q3: q3 === 'skip' ? 'skip' : Number(q3),
        q4: q4, q4Text: q4 === '小さく・少し変えて続ける' ? ($('#q4-text').value.trim() || null) : null,
        baseline: ctx.prelive ? ctx.prelive.bundles : null,
        baselineMiss: missAns ? { answer: missAns, lines: $all('input[name="missline"]:checked').map(function (i) { return Number(i.value); }) } : null,
        good: $('#good').value.trim() || null,
        numbers: numbers,
        kind: $('#kind').value
      };
      var first = ctx.logs.length === 0;
      M.saveLog(entry).then(function () { return M.focus(); }).then(function (f) {
        form.hidden = true;
        var box = $('#log-saved');
        var kids = [h('h2', { text: '記録しました' })];
        if (!fcs || q4 === '別の 1 つ') {
          kids.push(h('p', { text: '次の配信で試す 1 つを選びます。' }));
          kids.push(h('div', { class: 'btn-row' }, [h('a', { class: 'btn btn--primary', href: 'focus.html' }, ['ONE FOCUS の候補から選ぶ'])]));
        } else if (f.current) {
          kids.push(h('p', { text: q4 === '続ける' ? '同じ ONE FOCUS を、次の配信でも続けます。' : '次の配信の ONE FOCUS を、少し変えて続けます。' }));
          kids.push(h('p', { class: 'focus-text', text: f.current.text }));
          kids.push(h('p', { class: 'small muted', text: 'これまでに試した配信: ' + (f.current.tries || 0) + ' 回' }));
        }
        if (entry.q3 !== 'skip') {
          var card = D.cards.filter(function (c) { return c.id === entry.q3; })[0];
          if (card && (card.lessons.length || card.chapters.length)) {
            var links = card.lessons.map(function (id) { return h('li', {}, [h('a', { href: lessonHref(id) }, [lessonTitle(id)])]); })
              .concat(card.chapters.map(function (cid) { return h('li', {}, [h('a', { href: 'chapters/' + cid + '.html' }, [cid + ' の章'])]); }));
            kids.push(h('p', { class: 'small', text: '「' + card.text + '」に関係がある Lesson の例です。1 回の答えでは課題を決めません。ONE FOCUS も差し替えません。' }));
            kids.push(h('ul', { class: 'small' }, links));
          }
        }
        if (first && D.fastTrack.rightAfter) {
          kids.push(h('p', {}, ['最初の記録が残りました。続けて読む 1 本: ', h('a', { href: lessonHref(D.fastTrack.rightAfter) }, [lessonTitle(D.fastTrack.rightAfter)])]));
        }
        kids.push(h('p', {}, [h('a', { href: 'index.html' }, ['ホームへ'])]));
        fill(box, kids);
        box.hidden = false;
        box.scrollIntoView();
        return M.logs();
      }).then(function (logs) { ctx.logs = logs; renderLogs(logs); setupReview(logs); });
    });

    function renderLogs(logs) {
      if (!logs.length) { return; }
      fill($('#log-list'), [h('ul', { class: 'list' }, logs.slice().reverse().map(function (l) {
        var bits = [l.q1];
        if (l.q2) { bits.push('起きたこと: ' + l.q2); }
        bits.push('困った所: ' + (l.q3 === 'skip' ? '選ばない' : cardText(l.q3)));
        bits.push('次: ' + l.q4);
        if (l.returning) { bits.push('前にも来た人: ' + l.returning); }
        if (l.kind && l.kind !== '通常') { bits.push(l.kind); }
        var nums = Object.keys(l.numbers || {}).map(function (k) { return k + ' ' + l.numbers[k]; }).join('／');
        return h('li', {}, [h('div', { class: 'list__link' }, [
          h('span', { class: 'list__title', text: md(l.at) + '　' + (l.focus ? '「' + l.focus.text + '」' : 'ONE FOCUS なし') }),
          h('span', { class: 'list__meta', text: bits.join('　') }),
          l.good ? h('span', { class: 'list__meta', text: '良かったこと: ' + l.good }) : null,
          nums ? h('span', { class: 'list__meta', text: '数字: ' + nums }) : null])]);
      }))]);
    }

    function setupReview(logs) {
      var sec = $('#period-review');
      if (logs.length < 2) { sec.hidden = true; return; }
      sec.hidden = false;
      M.focus().then(function (f) {
        var rf = $('#review-focus');
        rf.hidden = !f.current;
        if (f.current) { rf.textContent = f.current.text; }
      });
      var tally = {};
      logs.forEach(function (l) { if (l.q3 !== 'skip') { tally[l.q3] = (tally[l.q3] || 0) + 1; } });
      var items = D.cards.filter(function (c) { return c.counts; }).map(function (c) {
        return h('li', { text: c.text + ': ' + (tally[c.id] || 0) + ' 回' });
      });
      fill($('#review-tally'), [h('p', { class: 'small', text: '記録した配信: ' + logs.length + ' 回' }), h('ul', {}, items)]);
    }
    $('#review-form').addEventListener('submit', function (ev) {
      ev.preventDefault();
      var tally = {}, top = null;
      ctx.logs.forEach(function (l) { if (l.q3 !== 'skip') { tally[l.q3] = (tally[l.q3] || 0) + 1; } });
      Object.keys(tally).forEach(function (k) { if (top === null || tally[k] > tally[top]) { top = k; } });
      var unchecked = $all('#review-form details input[type="checkbox"]').filter(function (i) { return !i.checked; })
        .map(function (i) { var lab = $('label[for="' + i.id + '"]'); return lab ? lab.textContent : ''; });
      var rest = $('#review-rest').checked;
      M.saveReview({ q1: checked('r1'), q2: top === null ? null : Number(top), rest: rest, fatigue: unchecked }).then(function (rev) {
        var words = {
          '意識しなくてもできる': 'この行動は「いつものこと」に移しました。配信前の確認で見られます。',
          'まだ続ける': '同じ ONE FOCUS を続けます。',
          '小さくする': 'ONE FOCUS の候補の画面で、文を小さく直してください。',
          '合っていないのでやめる': 'この ONE FOCUS は終えました。「試したこと」に残っています。'
        };
        var kids = ['振り返りを保存しました。' + (words[rev.q1] || '')];
        if (rest) { kids.push('次の 1 つは「休む」です。'); }
        else if (rev.q1 !== 'まだ続ける') { kids.push(h('a', { href: 'focus.html' }, ['次の ONE FOCUS を選ぶ'])); }
        fill($('#review-msg'), kids);
        setupReview(ctx.logs);
      });
    });
    renderLogs(ctx.logs);
    setupReview(ctx.logs);
  }

  /* ---------- スキルと習熟 ---------- */
  function initSkills(ctx) {
    Promise.all([M.evidence(), M.focusHistory()]).then(function (r) {
      var evs = r[0], hist = r[1];
      if (!evs.length && !ctx.logs.length) { return; }
      var f = evs.filter(function (e) { return e.type === 'F'; });
      var n = evs.filter(function (e) { return e.type !== 'F'; });
      fill($('#evidence-counts'), [h('ul', {}, [
        h('li', { text: '記録した配信: ' + ctx.logs.length + ' 回' }),
        h('li', { text: '本番でやった記録（自己申告）: ' + f.length + ' 件' }),
        h('li', { text: '自分の言葉の 1 行: ' + n.length + ' 件' }),
        h('li', { text: '試した ONE FOCUS: ' + (hist.length + (ctx.focus.current ? 1 : 0)) + ' つ' })
      ]), h('p', { class: 'small muted', text: '数は事実として出しているだけで、目標ではありません。' })]);
      $all('[data-track-evidence]').forEach(function (box) {
        var tid = box.getAttribute('data-track-evidence');
        var mine = evs.filter(function (e) { return (e.tracks || []).indexOf(tid) >= 0; });
        if (!mine.length) { return; }
        var hasF = mine.some(function (e) { return e.type === 'F'; });
        fill(box, [
          h('p', {}, [h('span', { class: 'badge badge--done', text: hasF ? '本番の記録があります（自己申告）' : '記録済み（自己申告）' })]),
          h('p', { class: 'small', text: '本番でやった記録: ' + mine.filter(function (e) { return e.type === 'F'; }).length +
            ' 件／自分の言葉の 1 行: ' + mine.filter(function (e) { return e.type !== 'F'; }).length + ' 件／最後の証拠: ' + md(mine[0].at) }),
          mine.some(function (e) { return e.counts === false; }) ? h('p', { class: 'small muted', text: '一部の証拠は、段には数えない Lesson のものです。' }) : null
        ]);
      });
      if (evs.length) {
        fill($('#evidence-list'), [h('ul', { class: 'list' }, evs.map(function (e) {
          var names = (e.tracks || []).map(function (t) { var x = D.tracks.filter(function (y) { return y.id === t; })[0]; return x ? x.name : t; });
          return h('li', {}, [h('div', { class: 'list__link' }, [
            h('span', { class: 'list__title', text: md(e.at) + '　' + (e.type === 'F' ? '本番でやった' : '自分の言葉の 1 行') + '　「' + e.text + '」' }),
            h('span', { class: 'list__meta', text: '確かめた人: ' + e.by + '　トラック: ' + (names.join('・') || '—') + (e.counts === false ? '　段には数えません' : '') }),
            e.lessonId ? h('span', { class: 'list__meta' }, [h('a', { href: lessonHref(e.lessonId) }, [lessonTitle(e.lessonId)])]) : null])]);
        }))]);
      }
    });
  }

  /* ---------- 道具箱（用語をさがす） ---------- */
  function initToolbox() {
    var input = $('#term-filter');
    if (!input) { return; }
    input.addEventListener('input', function () {
      var q = input.value.trim().toLowerCase();
      $all('[data-term]').forEach(function (el) { el.hidden = !!q && el.textContent.toLowerCase().indexOf(q) < 0; });
    });
  }

  /* ---------- 設定・自分のデータ ---------- */
  function initSettings(ctx) {
    var s = ctx.settings, S = window.LEAStore;
    var msg = $('#settings-msg');
    $('#set-performer').checked = !!s.performer;
    $('#set-firstlive').checked = !!s.firstLiveDone;
    $('#set-firstdate').value = s.firstLiveDate || '';
    $('#set-stage').value = s.baselineStage;
    $('#settings-form').addEventListener('change', function () {
      M.saveSettings({
        performer: $('#set-performer').checked, firstLiveDone: $('#set-firstlive').checked,
        firstLiveDate: $('#set-firstdate').value || null, baselineStage: $('#set-stage').value
      }).then(function () { msg.textContent = '保存しました。'; });
    });
    function summary() {
      Promise.all([M.logs(), M.evidence(), M.lessonRecords()]).then(function (r) {
        $('#data-summary').textContent = '配信の記録: ' + r[0].length + ' 件／証拠: ' + r[1].length + ' 件／印を付けた Lesson: ' + Object.keys(r[2]).length + ' 本' +
          (S.persistent ? '' : '（このブラウザでは保存が使えないため、ページを閉じると消えます）');
      });
    }
    summary();
    $('[data-act="data-export"]').addEventListener('click', function () {
      S.export().then(function (dump) {
        var blob = new Blob([JSON.stringify(dump, null, 2)], { type: 'application/json' });
        var a = h('a', { href: URL.createObjectURL(blob), download: 'learning-record-' + M.today() + '.json' });
        document.body.appendChild(a); a.click(); a.remove();
        $('#data-msg').textContent = '書き出しました。';
      });
    });
    $('#data-import-file').addEventListener('change', function (ev) {
      var file = ev.target.files[0];
      if (!file) { return; }
      var reader = new FileReader();
      reader.onload = function () {
        var dump;
        try { dump = JSON.parse(reader.result); } catch (e) { $('#data-msg').textContent = '読み込めないファイルです。'; return; }
        if (!window.confirm('読み込むと、同じ項目はファイルの内容で上書きされます。続けますか？')) { return; }
        S.import(dump).then(function () { $('#data-msg').textContent = '読み込みました。'; summary(); },
          function (e) { $('#data-msg').textContent = e.message; });
      };
      reader.readAsText(file);
    });
    $('[data-act="data-clear"]').addEventListener('click', function () {
      if (!window.confirm('このブラウザにある学習の記録を、すべて消します。元に戻せません。消しますか？')) { return; }
      S.clear().then(function () { $('#data-msg').textContent = 'すべて消しました。'; summary(); });
    });
  }

  /* ---------- 起動 ---------- */
  load().then(function (ctx) {
    applyCommon(ctx);
    var inits = { home: initHome, start: initStart, map: initMap, lesson: initLesson, focus: initFocus,
      prelive: initPrelive, postlive: initPostlive, skills: initSkills, toolbox: initToolbox, settings: initSettings };
    if (inits[pageKey]) { inits[pageKey](ctx); }
  }).catch(function (e) {
    if (window.console) { console.error(e); }
  });
})();
