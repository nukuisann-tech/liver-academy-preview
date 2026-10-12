/* contents.js — CONTENT LIBRARY と Content Article の動き。
 * 本文はすべて HTML に入っている。ここは「絞り込み・保存（MISSION・CLEAR のチェック）・STEP の進み具合・コピー」を足すだけ。
 *
 * 保存の窓口は CTStore の 1 か所だけ（ほかの場所で localStorage を直接触らない）。
 * 既存サイトの LEAStore（assets/js/store.js）と同じ 6 つの関数（get / set / list / remove / export / clear）で、
 * すべて Promise を返す。あとで LEAStore や API に載せ替えるときは、下の adapter だけを差し替える。
 *
 * 保存するもの（1 件 = 1 キー。値は { 欄の名前: 値 } と updatedAt）:
 *   field/<記事ID>/<セクションID>/b<番号>   本文の checklist（c0, c1…: true）・try のメモ（a: 文字）
 *   field/<記事ID>/mission                   次の配信で試すこと（m0, m1…: true）
 *   field/<記事ID>/clear                     できた目安（clear: true）
 *   field/<記事ID>/tool<番号>                道具（c*: チェック／w*: 記入／t*: テンプレートの書き換え／そのほか: 組み立ての欄）
 */
(function (global) {
  'use strict';
  var NAMESPACE = 'lea.contents.v1.';

  var adapter = (function () {
    var ls = null, mem = {};
    try { ls = global.localStorage; var t = NAMESPACE + '__t'; ls.setItem(t, '1'); ls.removeItem(t); } catch (e) { ls = null; }
    return {
      persistent: !!ls,
      read: function (k) { try { var v = ls ? ls.getItem(NAMESPACE + k) : mem[k]; return v ? JSON.parse(v) : null; } catch (e) { return null; } },
      write: function (k, v) { var s = JSON.stringify(v); try { if (ls) ls.setItem(NAMESPACE + k, s); else mem[k] = s; return true; } catch (e) { mem[k] = s; return false; } },
      drop: function (k) { try { if (ls) ls.removeItem(NAMESPACE + k); } catch (e) { /* 何もしない */ } delete mem[k]; },
      keys: function () {
        var out = [], i, k;
        if (ls) { try { for (i = 0; i < ls.length; i++) { k = ls.key(i); if (k && k.indexOf(NAMESPACE) === 0) out.push(k.slice(NAMESPACE.length)); } } catch (e) { /* 何もしない */ } }
        else { for (k in mem) if (Object.prototype.hasOwnProperty.call(mem, k)) out.push(k); }
        return out;
      }
    };
  })();

  var CTStore = {
    persistent: adapter.persistent,
    get: function (key) { return Promise.resolve(adapter.read(key)); },
    set: function (key, value) { return Promise.resolve(adapter.write(key, value)); },
    list: function (prefix) { return Promise.resolve(adapter.keys().filter(function (k) { return !prefix || k.indexOf(prefix) === 0; })); },
    remove: function (key) { adapter.drop(key); return Promise.resolve(true); },
    export: function () { var o = {}; adapter.keys().forEach(function (k) { o[k] = adapter.read(k); }); return Promise.resolve({ app: 'liver-elite-contents', schema: 1, data: o }); },
    clear: function () { adapter.keys().forEach(adapter.drop); return Promise.resolve(true); }
  };
  global.CTStore = CTStore;

  var doc = global.document;
  function all(sel, root) { return Array.prototype.slice.call((root || doc).querySelectorAll(sel)); }

  /* ---------------------------------------------------------------- Library: カテゴリの絞り込み */
  function initFilter() {
    var chips = all('.chip[data-filter]'), cards = all('#cards > .card'), count = doc.getElementById('count');
    if (!chips.length || !cards.length) return;
    chips.forEach(function (chip) {
      chip.addEventListener('click', function () {
        var key = chip.getAttribute('data-filter'), n = 0;
        chips.forEach(function (c) { c.setAttribute('aria-pressed', c === chip ? 'true' : 'false'); });
        cards.forEach(function (card) {
          var show = !key || card.getAttribute('data-cat') === key;
          card.hidden = !show;
          if (show) n++;
        });
        if (count) count.textContent = String(n);
      });
    });
  }

  /* ---------------------------------------------------------------- 記入・チェックの保存（data-save の入れ物ごとに 1 件） */
  function fieldValue(el) { return el.type === 'checkbox' ? el.checked : el.value; }

  function initSaves() {
    all('[data-save]').forEach(function (box) {
      var key = 'field/' + box.getAttribute('data-save');
      var fields = all('[data-field]', box);
      var tool = box.closest ? box.closest('.tool') : null;
      var note = tool ? tool.querySelector('[data-saved-msg]') : null;
      var counter = box.querySelector('[data-count]');
      var timer = null;
      fields.forEach(function (el) { el.setAttribute('data-default', el.type === 'checkbox' ? '' : el.value); });

      function refresh() {
        if (counter) {
          var boxes = fields.filter(function (el) { return el.type === 'checkbox'; });
          counter.textContent = boxes.filter(function (el) { return el.checked; }).length + ' / ' + boxes.length;
        }
        /* MISSION の進み具合・CLEAR の表示（チェックが全部付いたら is-done） */
        var cbs = fields.filter(function (el) { return el.type === 'checkbox'; });
        if (cbs.length) {
          var on = cbs.filter(function (el) { return el.checked; }).length;
          box.style.setProperty('--done', String(on / cbs.length));
          box.classList.toggle('is-done', on === cbs.length);
        }
        updateBuilder(box);
        fields.forEach(autoGrow);
      }
      function save() {
        var data = {}, any = false;
        fields.forEach(function (el) {
          var v = fieldValue(el), def = el.type === 'checkbox' ? false : el.getAttribute('data-default');
          if (v !== def) { data[el.getAttribute('data-field')] = v; any = true; }
        });
        var done = any ? CTStore.set(key, { values: data, updatedAt: new Date().toISOString() }) : CTStore.remove(key);
        done.then(function (ok) {
          if (!note) return;
          note.textContent = (ok && CTStore.persistent) ? '保存しました（このブラウザの中だけに残ります）' : 'このブラウザでは保存できません（ページを閉じると消えます）';
          note.classList.toggle('is-on', !!ok && CTStore.persistent);
        });
      }
      CTStore.get(key).then(function (rec) {
        var values = (rec && rec.values) || {};
        fields.forEach(function (el) {
          var k = el.getAttribute('data-field');
          if (!Object.prototype.hasOwnProperty.call(values, k)) return;
          if (el.type === 'checkbox') el.checked = !!values[k]; else el.value = String(values[k]);
        });
        refresh();
      });
      box.addEventListener('change', function () { refresh(); save(); });
      box.addEventListener('input', function (e) {
        if (e.target.type === 'checkbox') return;
        refresh();
        clearTimeout(timer);
        timer = setTimeout(save, 500);
      });
      all('[data-reset-field]', box).forEach(function (btn) {
        btn.addEventListener('click', function () {
          var el = btn.closest('.tpl__row').querySelector('[data-field]');
          el.value = el.getAttribute('data-default'); refresh(); save();
        });
      });
      if (tool) {
        var clear = tool.querySelector('[data-clear]');
        if (clear) clear.addEventListener('click', function () {
          if (!global.confirm('この道具に書いた内容を消します。よろしいですか？')) return;
          fields.forEach(function (el) { if (el.type === 'checkbox') el.checked = false; else el.value = el.getAttribute('data-default'); });
          refresh();
          CTStore.remove(key).then(function () { if (note) { note.textContent = '消しました'; note.classList.remove('is-on'); } });
        });
      }
    });
  }

  function autoGrow(el) {
    if (el.tagName !== 'TEXTAREA') return;
    el.style.height = 'auto';
    el.style.height = (el.scrollHeight + 2) + 'px';
  }

  /* 組み立てシート: 欄の中身を data-pattern の {名前} に入れて、出来上がりを見せる */
  function updateBuilder(box) {
    var out = box.querySelector('[data-result]');
    if (!out) return;
    var pattern = box.getAttribute('data-pattern') || '', filled = 0;
    var parts = {};
    all('[data-part]', box).forEach(function (el) { parts[el.getAttribute('data-part')] = el.value.trim(); if (el.value.trim()) filled++; });
    if (!filled) { out.textContent = ''; return; }
    var text = pattern.replace(/\{(\w+)\}/g, function (m, k) { return parts[k] || '\u0000'; });
    /* 空の欄は、前後の区切り（｜・／、など）ごと落とす */
    text = text.replace(/[\s｜|／\/・、]*\u0000[\s｜|／\/・、]*/g, function (m) { return /\n/.test(m) ? '\n' : '\u0001'; })
               .replace(/^\u0001|\u0001$/gm, '').replace(/\u0001/g, '｜').replace(/\n{2,}/g, '\n').trim();
    out.textContent = text;
  }

  /* ---------------------------------------------------------------- コピー */
  function copyText(text, btn) {
    var label = btn.querySelector('span') || btn, old = label.textContent;
    function done(ok) { label.textContent = ok ? 'コピーしました' : 'コピーできませんでした'; setTimeout(function () { label.textContent = old; }, 1800); }
    if (global.navigator.clipboard && global.navigator.clipboard.writeText) {
      global.navigator.clipboard.writeText(text).then(function () { done(true); }, function () { done(fallback(text)); });
    } else { done(fallback(text)); }
  }
  function fallback(text) {
    var ta = doc.createElement('textarea'); ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
    doc.body.appendChild(ta); ta.select();
    var ok = false; try { ok = doc.execCommand('copy'); } catch (e) { ok = false; }
    doc.body.removeChild(ta); return ok;
  }
  function initCopy() {
    all('[data-copy]').forEach(function (btn) {
      btn.addEventListener('click', function () { copyText(btn.closest('.tpl__row').querySelector('[data-copy-src]').value, btn); });
    });
    all('[data-copy-result]').forEach(function (btn) {
      btn.addEventListener('click', function () { var t = btn.closest('.sb').querySelector('[data-result]').textContent; if (t) copyText(t, btn); });
    });
  }

  /* ---------------------------------------------------------------- 記事: STEP の進み具合（いまどの STEP か）・読んだ位置 */
  function initToc() {
    var toc = doc.getElementById('toc'), bar = doc.getElementById('progress');
    if (!toc && !bar) return;
    var links = toc ? all('a[href^="#"]', toc) : [], map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var targets = Object.keys(map).map(function (id) { return doc.getElementById(id); }).filter(Boolean);
    var body = doc.querySelector('.art') || doc.querySelector('.art__grid'), ticking = false;
    function update() {
      ticking = false;
      var y = global.scrollY || doc.documentElement.scrollTop, line = y + global.innerHeight * 0.3, cur = null;
      targets.forEach(function (t) { if (t.getBoundingClientRect().top + y <= line) cur = t; });
      var curAt = cur ? links.indexOf(map[cur.id]) : -1;
      links.forEach(function (a, i) {
        if (i === curAt) a.setAttribute('aria-current', 'true'); else a.removeAttribute('aria-current');
        a.classList.toggle('is-past', i < curAt);
      });
      if (bar && body) {
        var top = body.getBoundingClientRect().top + y, h = body.offsetHeight - global.innerHeight * 0.6;
        bar.style.width = Math.max(0, Math.min(100, (y - top + global.innerHeight * 0.4) / h * 100)) + '%';
      }
    }
    global.addEventListener('scroll', function () { if (!ticking) { ticking = true; global.requestAnimationFrame(update); } }, { passive: true });
    global.addEventListener('resize', update);
    update();
  }

  /* ---------------------------------------------------------------- v4: 動き（理解を助けるものだけ。素の JS）
   * どれも「JS が無い・動きを減らす設定」のときは、CSS だけで最終の状態が出る（ここでクラスを付けたときだけ動く）。
   *   HERO compare（slider）: .is-live を付けて 1 台に重ね、--pos（0〜100%）でつまみの位置を決める。指・マウス・キーボード。
   *   HERO compare（toggle）: .is-live と data-show（before / after）。画面に入ったら 1 回だけ after へ。
   *   HERO chat: .is-armed を付け、吹き出し（.hx__line）に順に .is-in。「もう一度見る」で再生。くり返さない。
   *   3 つの光（[data-lights]）: .is-armed のあと .is-k → .is-f → .is-b。
   *   Scroll Reveal: .rv を付け、画面に入ったら .is-in。 */
  var reduce = !!(global.matchMedia && global.matchMedia('(prefers-reduced-motion: reduce)').matches);
  var hasIO = 'IntersectionObserver' in global;

  function onView(el, fn, threshold) {
    if (!el) return;
    if (!hasIO) { fn(); return; }
    var io = new global.IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { io.disconnect(); fn(); } });
    }, { threshold: threshold == null ? 0.5 : threshold });
    io.observe(el);
  }

  function initCompare() {
    all('[data-hero="compare"]').forEach(function (root) {
      var stage = root.querySelector('.hc__stage');
      if (!stage) return;
      if (root.getAttribute('data-mode') === 'toggle') {
        var btns = all('.hc__sw', root), touched = false;
        var show = function (w) {
          root.setAttribute('data-show', w); root.setAttribute('data-lean', w);
          btns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-show') === w ? 'true' : 'false'); });
        };
        root.classList.add('is-live');
        btns.forEach(function (b) { b.addEventListener('click', function () { touched = true; show(b.getAttribute('data-show')); }); });
        stage.addEventListener('click', function () { touched = true; show(root.getAttribute('data-show') === 'after' ? 'before' : 'after'); });
        if (reduce) { show('after'); return; }
        show('before');
        onView(stage, function () { setTimeout(function () { if (!touched) show('after'); }, 900); }, 0.6);
        return;
      }
      if (reduce) return;  /* 動きを減らす設定: 左右に並べたまま */
      var range = root.querySelector('.hc__range'), dragging = false, used = false;
      var set = function (v, fromRange) {
        v = Math.max(0, Math.min(100, v));
        root.style.setProperty('--pos', v + '%');
        var lean = v > 62 ? 'before' : (v < 38 ? 'after' : '');
        if (lean) root.setAttribute('data-lean', lean); else root.removeAttribute('data-lean');
        if (range && !fromRange) range.value = String(Math.round(v));
      };
      var at = function (e) { var r = stage.getBoundingClientRect(); if (r.width) set((e.clientX - r.left) / r.width * 100); };
      var stop = function () { dragging = false; root.classList.remove('is-drag'); };
      root.classList.add('is-live');
      set(50);
      if (range) {
        range.addEventListener('input', function () { used = true; root.classList.remove('is-hint'); set(Number(range.value), true); });
      }
      stage.addEventListener('pointerdown', function (e) {
        if (e.button) return;
        dragging = true; used = true;
        root.classList.remove('is-hint'); root.classList.add('is-drag');
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* 何もしない */ }
        at(e);
        if (e.pointerType === 'mouse') e.preventDefault();
      });
      stage.addEventListener('pointermove', function (e) { if (dragging) at(e); });
      stage.addEventListener('pointerup', stop);
      stage.addEventListener('pointercancel', stop);
      stage.addEventListener('dragstart', function (e) { e.preventDefault(); });
      /* 画面に入ったら 1 回だけ、つまみを少し左右に振って「動かせる」ことを見せる */
      onView(stage, function () {
        var steps = [[500, 68], [1150, 34], [1800, 50]];
        steps.forEach(function (s) { setTimeout(function () { if (used) return; root.classList.add('is-hint'); set(s[1]); }, s[0]); });
        setTimeout(function () { root.classList.remove('is-hint'); }, 2500);
      }, 0.6);
    });
  }

  function initChat() {
    all('[data-hero="chat"]').forEach(function (root) {
      var lines = all('.hx__line', root), stages = all('.hx__stage', root), btn = root.querySelector('.hx__replay'), timers = [];
      if (!lines.length) return;
      if (reduce) { if (btn) btn.hidden = true; return; }
      var mark = function (n) {
        lines.forEach(function (li, i) { li.classList.toggle('is-in', i < n); });
        stages.forEach(function (st) { st.classList.toggle('is-on', n >= Number(st.getAttribute('data-start'))); });
      };
      var play = function () {
        timers.forEach(clearTimeout); timers = [];
        root.classList.add('is-armed');
        mark(1);  /* 最初は「入室」だけ */
        lines.forEach(function (li, i) { if (i) timers.push(setTimeout(function () { mark(i + 1); }, 600 + (i - 1) * 480)); });
      };
      root.classList.add('is-armed');
      mark(1);
      onView(root.querySelector('.hx__phone'), play, 0.55);
      if (btn) btn.addEventListener('click', play);
    });
  }

  function initLights() {
    all('[data-lights]').forEach(function (root) {
      var btn = root.querySelector('[data-lights-replay]'), timers = [];
      if (reduce) { if (btn) btn.hidden = true; return; }
      var play = function () {
        timers.forEach(clearTimeout); timers = [];
        root.classList.add('is-armed');
        root.classList.remove('is-k', 'is-f', 'is-b');
        ['is-k', 'is-f', 'is-b'].forEach(function (c, i) { timers.push(setTimeout(function () { root.classList.add(c); }, 500 + i * 700)); });
      };
      root.classList.add('is-armed');
      onView(root.querySelector('.dgs__fig'), play, 0.5);
      if (btn) btn.addEventListener('click', play);
    });
  }

  var REVEAL = '.kb__book, .oc__h, .oc__say, .ov, .sec__head, .sec > .b, .pro__head, .pro__item, .cn__h, .cn__item, .loop, .sum__h, .goal, .nx__next';
  function initReveal() {
    if (reduce || !hasIO || !doc.querySelector('.page-article')) return;
    var io = new global.IntersectionObserver(function (es) {
      es.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0 });
    var add = function (el, delay) { el.classList.add('rv'); if (delay) el.style.setProperty('--rv-d', delay + 'ms'); io.observe(el); };
    all(REVEAL).forEach(function (el) { add(el, 0); });
    all('[data-reveal="steps"]').forEach(function (list) {
      Array.prototype.forEach.call(list.children, function (li, i) { add(li, Math.min(i, 6) * 70); });
    });
  }

  function init() { initFilter(); initSaves(); initCopy(); initToc(); initCompare(); initChat(); initLights(); initReveal(); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
