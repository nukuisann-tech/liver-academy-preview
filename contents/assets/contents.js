/* contents.js — CONTENT LIBRARY と Content Article の動き。
 * 本文はすべて HTML に入っている。ここは「絞り込み・保存（試すこと・できた目安のチェック）・STEP の進み具合・コピー」を足すだけ。
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
    var chips = all('.chip[data-filter]'), cards = all('#cards > li'), count = doc.getElementById('count');
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
  function isTick(el) { return el.type === 'checkbox' || el.type === 'radio'; }
  function fieldValue(el) { return isTick(el) ? el.checked : el.value; }

  function initSaves() {
    all('[data-save]').forEach(function (box) {
      var key = 'field/' + box.getAttribute('data-save');
      var fields = all('[data-field]', box);
      var tool = box.closest ? box.closest('.tool') : null;
      var note = tool ? tool.querySelector('[data-saved-msg]') : null;
      var counter = box.querySelector('[data-count]');
      var timer = null;
      fields.forEach(function (el) { el.setAttribute('data-default', isTick(el) ? '' : el.value); });

      function refresh() {
        if (counter) {
          var boxes = fields.filter(function (el) { return el.type === 'checkbox'; });
          counter.textContent = boxes.filter(function (el) { return el.checked; }).length + ' / ' + boxes.length;
        }
        /* 「試すこと」の進み具合・「できた目安」の表示（チェックが全部付いたら is-done） */
        var cbs = fields.filter(function (el) { return el.type === 'checkbox'; });
        if (cbs.length) {
          var on = cbs.filter(function (el) { return el.checked; }).length;
          box.style.setProperty('--done', String(on / cbs.length));
          box.classList.toggle('is-done', on === cbs.length);
        }
        updateBuilder(box);
        updateWorkshop(box);
        updateReflect(box);
        updateTimeWeek(box);
        fields.forEach(autoGrow);
      }
      function save() {
        var data = {}, any = false;
        fields.forEach(function (el) {
          var v = fieldValue(el), def = isTick(el) ? false : el.getAttribute('data-default');
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
          if (isTick(el)) el.checked = !!values[k]; else el.value = String(values[k]);
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
          fields.forEach(function (el) { if (isTick(el)) el.checked = false; else el.value = el.getAttribute('data-default'); });
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

  /* ワークショップ（batch 02）: 書いた文字を、下のカードへ並べるだけ（生成はしない）。選択は data-max 個まで。 */
  function updateWorkshop(box) {
    if (!box.hasAttribute('data-workshop')) return;
    var val = function (k) {
      var el = box.querySelector('[data-field="' + k + '"]');
      if (el) return el.value.trim();
      return all('input[data-choice="' + k + '"]', box).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-label'); }).join('・');
    };
    all('.wk__row--choices', box).forEach(function (row) {
      var max = Number(row.getAttribute('data-max')) || 3, cbs = all('input[type="checkbox"]', row);
      var on = cbs.filter(function (c) { return c.checked; }).length;
      cbs.forEach(function (c) { c.disabled = !c.checked && on >= max; });
      var mn = row.querySelector('[data-maxnote]'); if (mn) mn.hidden = on < max;
    });
    var filled = 0;
    all('[data-out]', box).forEach(function (dd) {
      var v = val(dd.getAttribute('data-out')) || (dd.getAttribute('data-alt') ? val(dd.getAttribute('data-alt')) : '');
      var only = dd.getAttribute('data-only');
      if (only !== null) {  /* その答えのときだけ行を出す（例: 居心地チェックの「改善したい」だけを並べる） */
        dd.parentNode.hidden = v !== only;
        if (v !== only) return;
      }
      dd.textContent = v || dd.getAttribute('data-empty') || '';
      dd.classList.toggle('is-empty', !v);
      if (v) filled++;
    });
    all('[data-out-chips]', box).forEach(function (ul) {
      var k = ul.getAttribute('data-out-chips');
      var picked = all('input[data-choice="' + k + '"]', box).filter(function (c) { return c.checked; });
      ul.textContent = '';
      picked.forEach(function (c) { var li = doc.createElement('li'); li.textContent = c.getAttribute('data-label'); ul.appendChild(li); });
      if (!picked.length && ul.getAttribute('data-empty')) { var e = doc.createElement('li'); e.className = 'is-empty'; e.textContent = ul.getAttribute('data-empty'); ul.appendChild(e); }
      if (picked.length) filled++;
    });
    all('[data-out-line]', box).forEach(function (p) {
      var missing = false;
      var text = (p.getAttribute('data-out-line') || '').replace(/\{(\w+)\}/g, function (m, k) { var v = val(k); if (!v) missing = true; return v; });
      p.textContent = missing ? (p.getAttribute('data-empty') || '') : text;
      p.classList.toggle('is-empty', missing);
    });
    all('.wk__mx', box).forEach(function (mx) {  /* 2×2: 縦（y）と横（x）の選択で、1 つのマスを点ける */
      var pick = function (k) { var c = all('input[data-choice="' + k + '"]', box).filter(function (x) { return x.checked; })[0]; return c ? c.getAttribute('data-idx') : null; };
      var y = pick(mx.getAttribute('data-mx-y')), x = pick(mx.getAttribute('data-mx-x'));
      all('.wk__cell', mx).forEach(function (cell) { cell.classList.toggle('is-on', y !== null && x !== null && cell.getAttribute('data-cell') === y + x); });
      mx.classList.toggle('is-picked', y !== null && x !== null);
    });
    all('.wk__fb', box).forEach(function (p) {  /* 選んだものへの一言（正解・不正解ではなく、誰に何が伝わるか） */
      var c = box.querySelector('input[data-choice="' + p.getAttribute('data-fb-key') + '"][data-idx="' + p.getAttribute('data-fb-idx') + '"]');
      p.hidden = !(c && c.checked);
    });
    if (box.hasAttribute('data-bridge')) {  /* ほかの記事で使う結果（例: 視聴者の欲しいもの → CT-014） */
      var bk = box.getAttribute('data-bridge-field');
      var labels = all('input[data-choice="' + bk + '"]', box).filter(function (c) { return c.checked; }).map(function (c) { return c.getAttribute('data-label'); });
      CTStore.set('bridge/' + box.getAttribute('data-bridge'), { labels: labels, updatedAt: new Date().toISOString() });
    }
    if (box.hasAttribute('data-bridge-fields')) {  /* 書いた欄の値を、そのまま次の記事へ（例: MY CREATOR ADVANTAGE → CT-014） */
      var vals = {}, anyv = false;
      box.getAttribute('data-bridge-fields').split('|').forEach(function (k) { vals[k] = val(k); if (vals[k]) anyv = true; });
      var bp = anyv ? CTStore.set('bridge/' + box.getAttribute('data-bridge'), { values: vals, updatedAt: new Date().toISOString() })
                    : CTStore.remove('bridge/' + box.getAttribute('data-bridge'));
      if (bp && bp.then) bp.then(initSuggest);
    }
    var card = box.querySelector('.wk__card');
    if (card) card.classList.toggle('is-on', filled > 0);
  }

  /* ふり返り（v3）: はい／いいえを選ぶと、その答えへの一言だけを出す */
  function updateTimeWeek(box) {
    if (!box.classList.contains('tw')) return;
    var goal = parseFloat(box.getAttribute('data-goal')) || 0, sum = 0, days = 0;
    all('.tw__in', box).forEach(function (el) {
      var v = parseFloat(el.value);
      if (!isNaN(v) && v > 0) { sum += Math.min(v, 24); days++; }
    });
    var fmt = function (n) { return (Math.round(n * 10) / 10) + ' 時間'; };
    var put = function (k, t) { var el = box.querySelector('[data-tw="' + k + '"]'); if (el) el.textContent = t; };
    put('sum', fmt(sum));
    put('gap', sum > goal ? '目安を超えています。疲れと反応も記録しましょう' : (sum === goal ? '目安に届いています' : 'あと ' + fmt(goal - sum)));
    put('avg', days ? fmt(sum / days) + '（' + days + '日）' : '—');
    put('rest', (all('.tw__in', box).length - days) + '日');
  }

  function updateReflect(box) {
    if (!box.classList.contains('rf')) return;
    var on = all('input[type="radio"]', box).filter(function (r) { return r.checked; })[0];
    all('[data-reply]', box).forEach(function (p) { p.hidden = !on || p.getAttribute('data-reply') !== on.getAttribute('data-v'); });
  }

  /* 別の記事で保存したものから、最初の値を入れる（data-from="<bridge の key>:<欄>"）。書き換えた欄は上書きしない。
     replace: この値のどれかが入っている欄は、自動で入れたものとみなして入れ替える（診断を答え直したとき）。 */
  function fillFrom(replace) {
    var els = all('[data-from]');
    if (!els.length) return;
    var keys = {};
    els.forEach(function (el) { keys[el.getAttribute('data-from').split(':')[0]] = 1; });
    Promise.all(Object.keys(keys).map(function (k) { return CTStore.get('bridge/' + k).then(function (r) { return [k, r]; }); })).then(function (rs) {
      var recs = {};
      rs.forEach(function (x) { recs[x[0]] = x[1]; });
      els.forEach(function (el) {
        var p = el.getAttribute('data-from').split(':'), r = recs[p[0]];
        if (!r) return;
        var v = r.values && r.values[p[1]] ? r.values[p[1]] : r[p[1]];
        if (!v) return;
        var cur = el.value, auto = el.getAttribute('data-auto');
        if (cur === v) { el.setAttribute('data-auto', v); return; }
        if (cur === '' || cur === auto || (replace && replace.indexOf(cur) >= 0)) {
          el.value = v; el.setAttribute('data-auto', v);
          el.dispatchEvent(new Event('input', { bubbles: true }));
        }
      });
    });
  }

  /* 候補から入れる（data-sug="<bridge の key>:<欄>"）: 保存がある候補だけボタンを出し、押したときだけ欄へ入れる。 */
  function initSuggest() {
    all('[data-sug-for]').forEach(function (wrap) {
      var input = doc.getElementById(wrap.getAttribute('data-sug-for'));
      var btns = all('[data-sug]', wrap);
      Promise.all(btns.map(function (bt) { return CTStore.get('bridge/' + bt.getAttribute('data-sug').split(':')[0]); })).then(function (rs) {
        var n = 0;
        btns.forEach(function (bt, i) {
          var f = bt.getAttribute('data-sug').split(':')[1], r = rs[i];
          var v = r && r.values && r.values[f] ? r.values[f] : '';
          bt.hidden = !v; bt.setAttribute('data-v', v);
          bt.textContent = (bt.getAttribute('data-sug-label') ? bt.getAttribute('data-sug-label') + '：' : '') + v;
          if (v) n++;
          if (!bt.hasAttribute('data-bound')) {
            bt.setAttribute('data-bound', '');
            bt.addEventListener('click', function () {
              if (!input) return;
              input.value = bt.getAttribute('data-v'); input.dispatchEvent(new Event('input', { bubbles: true })); input.focus();
            });
          }
        });
        wrap.hidden = !n;
      });
    });
  }

  /* 前の記事の成果物を見せる（v3 の recall）。もう一度入力させない。保存が無いときは、前の記事への案内だけ。 */
  function initRecall() {
    all('[data-recall]').forEach(function (root) {
      var key = root.getAttribute('data-recall'), fb = root.getAttribute('data-fallback'), mt = root.getAttribute('data-match');
      Promise.all([CTStore.get('bridge/' + key), fb ? CTStore.get('bridge/' + fb) : Promise.resolve(null)]).then(function (r) {
        var vals = (r[0] && r[0].values) || {}, st = r[1] || {}, n = 0;
        if (mt) {  /* 条件つき: 前の記事の結果が、この記事に関係するときだけ出す */
          var mp = mt.split(':');
          if (String(vals[mp[0]] || '').indexOf(mp[1]) < 0) { root.hidden = true; return; }
          root.hidden = false;
        }
        all('[data-r]', root).forEach(function (dd) {
          var k = dd.getAttribute('data-r'), v = vals[k] || st[dd.getAttribute('data-alt') || k] || '';
          dd.textContent = v; dd.parentNode.hidden = !v; if (v) n++;
        });
        var rows = root.querySelector('.rc__rows'), empty = root.querySelector('.rc__empty'), go = root.querySelector('.rc__go');
        if (rows) rows.hidden = !n;
        if (empty) empty.hidden = !!n;
        if (go) go.hidden = !!n;
        root.classList.toggle('is-filled', !!n);
      });
    });
  }

  /* 切り替えて見くらべる（batch 02 の switch）: .is-live のとき、選んだ 1 枚だけを出す。 */
  function initIdeaBank() {
    all('[data-ib]').forEach(function (box) {
      var sel = {};
      function apply() {
        var n = 0;
        all('.ib__card', box).forEach(function (c) {
          var ok = Object.keys(sel).every(function (k) {
            if (!sel[k]) return true;
            return (c.getAttribute('data-' + k) || '').split('|').indexOf(sel[k]) >= 0;
          });
          c.hidden = !ok; if (ok) n++;
        });
        var cnt = box.querySelector('[data-ib-count]'); if (cnt) cnt.textContent = String(n);
      }
      all('.ib__chip', box).forEach(function (btn) {
        btn.setAttribute('aria-pressed', btn.classList.contains('is-on') ? 'true' : 'false');
        btn.addEventListener('click', function () {
          var k = btn.getAttribute('data-ib-key');
          sel[k] = btn.getAttribute('data-ib-val');
          all('.ib__chip[data-ib-key="' + k + '"]', box).forEach(function (b) { var on = b === btn; b.classList.toggle('is-on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
          apply();
        });
      });
    });
  }

  function initSwitch() {
    all('[data-switch]').forEach(function (root) {
      var tabs = all('.sw__tab', root), panes = all('.sw__pane', root);
      if (tabs.length < 2) return;
      var show = function (i) {
        tabs.forEach(function (t, k) { t.setAttribute('aria-pressed', k === i ? 'true' : 'false'); });
        panes.forEach(function (p, k) { p.classList.toggle('is-on', k === i); });
      };
      root.classList.add('is-live');
      tabs.forEach(function (t, i) {
        t.addEventListener('click', function () { show(i); });
        t.addEventListener('keydown', function (e) {  /* 左右の矢印キーで、となりのタブへ */
          var k = e.key === 'ArrowRight' ? 1 : (e.key === 'ArrowLeft' ? -1 : 0);
          if (!k) return;
          e.preventDefault();
          var n = (i + k + tabs.length) % tabs.length;
          show(n); tabs[n].focus();
        });
      });
      show(0);
    });
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
   *     注釈（.hc__memo）: data-note（before / after / both）。つまみが半分より右なら before 側、左なら after 側の注釈だけを出す。
   *   HERO compare（toggle）: .is-live と data-show（before / after）。画面に入ったら 1 回だけ after へ。
   *   HERO chat: .is-armed を付け、吹き出し（.hx__line）に順に .is-in。「もう一度見る」で再生。くり返さない。
   *     意味（.hx__m）: 吹き出しが出るのに合わせて、決まった場所に 1 つだけ .is-now（同時に 2 つ出さない）。
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
        root.setAttribute('data-note', v > 50 ? 'before' : (v < 50 ? 'after' : 'both'));
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
      var means = all('.hx__m', root), meanBox = root.querySelector('.hx__mean');
      if (!lines.length) return;
      if (reduce) { if (btn) btn.hidden = true; return; }
      var meanOf = function (i) { for (var k = 0; k < means.length; k++) if (Number(means[k].getAttribute('data-i')) === i) return means[k]; return null; };
      var mark = function (n) {
        lines.forEach(function (li, i) { li.classList.toggle('is-in', i < n); });
        stages.forEach(function (st) { st.classList.toggle('is-on', n >= Number(st.getAttribute('data-start'))); });
        /* 意味は「いちばん新しく出た、意味つきの吹き出し」の 1 つだけ */
        var now = 0;
        means.forEach(function (m) { var i = Number(m.getAttribute('data-i')); if (i <= n && i > now) now = i; });
        means.forEach(function (m) { m.classList.toggle('is-now', Number(m.getAttribute('data-i')) === now); });
        lines.forEach(function (li, i) { li.classList.toggle('is-now', i + 1 === now); });
        if (meanBox) meanBox.classList.toggle('has-now', !!now);
      };
      var play = function () {
        timers.forEach(clearTimeout); timers = [];
        root.classList.add('is-armed');
        mark(1);  /* 最初は「入室」だけ */
        var t = 700;
        lines.forEach(function (li, i) {
          if (!i) return;
          timers.push(setTimeout(function () { mark(i + 1); }, t));
          t += meanOf(i + 1) ? 1500 : 800;  /* 意味が出る吹き出しのあとは、読む間を取る */
        });
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

  /* ---------------------------------------------------------------- batch 02: 記事ごとの HERO（contents_tpl/hero2.py）
   *   versus  : .is-live と data-show（a / b）。画面に入ったら 1 回だけ a → b へ。切り替えるたびに .is-in を付け直して、順に出す。
   *   builder : .is-armed でパネルを閉じる。3 枚とも開くと .is-done（カードが完成）。
   *   timeline: .is-armed のあと、行に順に .is-on。くり返さない。 */
  function initVersus() {
    all('[data-hero="versus"]').forEach(function (root) {
      var tabs = all('.hv__tab', root), touched = false;
      var show = function (w) {
        root.setAttribute('data-show', w);
        tabs.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-show') === w ? 'true' : 'false'); });
        root.classList.remove('is-in');
        global.requestAnimationFrame(function () { global.requestAnimationFrame(function () { root.classList.add('is-in'); }); });
      };
      root.classList.add('is-live');
      tabs.forEach(function (b) { b.addEventListener('click', function () { touched = true; show(b.getAttribute('data-show')); }); });
      if (reduce) { show('b'); return; }
      show('a');
      onView(root, function () { setTimeout(function () { if (!touched) show('b'); }, 1100); }, 0.6);
    });
  }

  function initBuilder() {
    all('[data-hero="builder"]').forEach(function (root) {
      var panels = all('.hb__panel', root), chips = all('.hb__chip', root), replay = root.querySelector('.hb__replay');
      if (!panels.length) return;
      var sync = function () {
        var n = 0;
        panels.forEach(function (p, i) {
          var open = p.getAttribute('aria-expanded') === 'true';
          if (open) n++;
          if (chips[i]) chips[i].classList.toggle('is-on', open);
        });
        root.classList.toggle('is-done', n === panels.length);
        if (replay) replay.hidden = n !== panels.length;
      };
      var reset = function () { panels.forEach(function (p) { p.setAttribute('aria-expanded', 'false'); }); sync(); };
      root.classList.add('is-armed');
      panels.forEach(function (p) { p.addEventListener('click', function () { p.setAttribute('aria-expanded', p.getAttribute('aria-expanded') === 'true' ? 'false' : 'true'); sync(); }); });
      if (replay) replay.addEventListener('click', function () { reset(); panels[0].focus(); });
      reset();
    });
  }

  function initTimeline() {
    all('[data-hero="timeline"]').forEach(function (root) {
      var rows = all('.ht__row', root), btn = root.querySelector('.ht__replay'), timers = [];
      if (reduce) { if (btn) btn.hidden = true; return; }
      var play = function () {
        timers.forEach(clearTimeout); timers = [];
        root.classList.add('is-armed');
        rows.forEach(function (r) { r.classList.remove('is-on'); });
        rows.forEach(function (r, i) { timers.push(setTimeout(function () { r.classList.add('is-on'); }, 350 + i * 420)); });
      };
      root.classList.add('is-armed');
      onView(root, play, 0.3);
      if (btn) btn.addEventListener('click', play);
    });
  }

  /* batch 03: lightlab（光の位置の切替。data-show）と bgbuilder（背景の層を 1 つずつ足す。.is-l1〜3 と .is-full） */
  function initLightLab() {
    all('[data-hero="lightlab"]').forEach(function (root) {
      var tabs = all('.ll__tab', root);
      root.classList.add('is-live');
      tabs.forEach(function (t) {
        t.addEventListener('click', function () {
          root.setAttribute('data-show', t.getAttribute('data-k'));
          tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === t ? 'true' : 'false'); });
        });
      });
    });
  }

  function initBgBuilder() {
    all('[data-hero="bgbuilder"]').forEach(function (root) {
      var btns = all('.bb__btn', root);
      var sync = function () {
        var n = 0;
        btns.forEach(function (b) { var on = b.getAttribute('aria-pressed') === 'true'; root.classList.toggle('is-l' + b.getAttribute('data-i'), on); if (on) n++; });
        root.classList.toggle('is-full', n === btns.length);
      };
      root.classList.add('is-live');
      btns.forEach(function (b) { b.setAttribute('aria-pressed', 'false'); b.addEventListener('click', function () { b.setAttribute('aria-pressed', b.getAttribute('aria-pressed') === 'true' ? 'false' : 'true'); sync(); }); });
      sync();
    });
  }

  /* batch 04: launch（番号で進む 3 段。data-step）と promise（あいまい ⇄ はっきり。data-show。はっきりのとき流れが順に点く） */
  function initLaunch() {
    all('[data-hero="launch"]').forEach(function (root) {
      var tabs = all('.hl__tab', root), next = root.querySelector('.hl__next'), lab = root.querySelector('.hl__nextlab');
      var go = function (n) {
        root.setAttribute('data-step', String(n));
        tabs.forEach(function (t) { t.setAttribute('aria-pressed', t.getAttribute('data-s') === String(n) ? 'true' : 'false'); });
        tabs.forEach(function (t) { t.classList.toggle('is-done', Number(t.getAttribute('data-s')) < n); });
        if (lab) lab.textContent = n >= tabs.length ? '最初から見る' : '次のステップへ';
      };
      root.classList.add('is-live');
      tabs.forEach(function (t) { t.addEventListener('click', function () { go(Number(t.getAttribute('data-s'))); }); });
      if (next) next.addEventListener('click', function () { var n = Number(root.getAttribute('data-step')) || 1; go(n >= tabs.length ? 1 : n + 1); });
      go(1);
    });
  }

  function initPromise() {
    all('[data-hero="promise"]').forEach(function (root) {
      var tabs = all('.hp__tab', root), touched = false;
      var show = function (w) {
        root.setAttribute('data-show', w);
        tabs.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-show') === w ? 'true' : 'false'); });
        root.classList.remove('is-in');
        global.requestAnimationFrame(function () { global.requestAnimationFrame(function () { root.classList.add('is-in'); }); });
      };
      root.classList.add('is-live');
      tabs.forEach(function (b) { b.addEventListener('click', function () { touched = true; show(b.getAttribute('data-show')); }); });
      if (reduce) { show('clear'); return; }
      show('vague');
      onView(root, function () { setTimeout(function () { if (!touched) show('clear'); }, 1100); }, 0.6);
    });
  }

  /* batch 05: panel（確認パネル）・compass（診断。結果を bridge/style に保存）・joinin（途中参加）・bridge（ほかの記事の結果を読む） */
  var PF_ST = ['未確認', '確認中', 'OK'];
  function initPanel() {
    all('[data-hero="panel"]').forEach(function (root) {
      var items = all('.pf__item', root), cnt = root.querySelector('.pf__count b'), must = Number(root.getAttribute('data-must')) || 0;
      var sync = function () {
        var ok = items.filter(function (b) { return b.classList.contains('pf__item--must') && b.getAttribute('data-state') === '2'; }).length;
        if (cnt) cnt.textContent = String(ok);
        root.classList.toggle('is-ready', ok === must && must > 0);
      };
      root.classList.add('is-live');
      items.forEach(function (b) {
        b.addEventListener('click', function () {
          var n = (Number(b.getAttribute('data-state')) + 1) % 3;
          b.setAttribute('data-state', String(n));
          b.querySelector('.pf__st').textContent = PF_ST[n];
          b.setAttribute('aria-label', b.querySelector('.pf__lab').firstChild.textContent + '：' + PF_ST[n]);
          sync();
        });
      });
      sync();
    });
  }

  function initCompass() {
    all('[data-hero="compass"]').forEach(function (root) {
      var styles = {}; try { styles = JSON.parse(root.getAttribute('data-styles')) || {}; } catch (e) { styles = {}; }
      var opts = all('.cp__opt', root), card = root.querySelector('.cp__card'), wait = root.querySelector('.cp__wait');
      var nq = all('.cp__q', root).length, ans = {};
      var order = ['A', 'B', 'C', 'D'];
      var show = function (save) {
        opts.forEach(function (o) { o.setAttribute('aria-pressed', ans[o.getAttribute('data-q')] === o.getAttribute('data-v') ? 'true' : 'false'); });
        if (Object.keys(ans).length < nq) { card.hidden = true; wait.hidden = false; return; }
        var c = {}; order.forEach(function (k) { c[k] = 0; });
        Object.keys(ans).forEach(function (q) { c[ans[q]]++; });
        var max = Math.max.apply(null, order.map(function (k) { return c[k]; }));
        var tops = order.filter(function (k) { return c[k] === max; });
        var primary = tops.indexOf(ans['0']) >= 0 ? ans['0'] : tops[0];  /* 同じ数なら、Q1（疲れにくい）の答えを主軸に */
        var rest = order.filter(function (k) { return k !== primary && c[k] > 0; }).sort(function (a, b) { return c[b] - c[a]; });
        var secondary = rest[0] || '';
        var P = styles[primary] || {}, S = styles[secondary] || {};
        var put = function (k, v) { var el = card.querySelector('[data-r="' + k + '"]'); if (el) el.textContent = v; };
        put('primary', primary + '　' + (P.name || ''));
        put('secondary', secondary ? secondary + '　' + (S.name || '') : 'なし（主軸で試してみる）');
        put('experience', (P.experience || '') + (secondary && S.experience ? '　＋　' + S.experience : ''));
        put('try', P.try || '');
        card.hidden = false; wait.hidden = true;
        if (save) {
          CTStore.set('bridge/style', { primary: primary, secondary: secondary, primaryName: P.name || '', secondaryName: S.name || '', answers: ans, updatedAt: new Date().toISOString() })
            .then(function () { fillFrom(order.map(function (k) { return (styles[k] || {}).name; })); });
        }
      };
      opts.forEach(function (o) { o.addEventListener('click', function () { ans[o.getAttribute('data-q')] = o.getAttribute('data-v'); show(true); }); });
      var reset = root.querySelector('.cp__reset');
      if (reset) reset.addEventListener('click', function () { ans = {}; CTStore.remove('bridge/style'); show(false); if (opts[0]) opts[0].focus(); });
      root.setAttribute('data-ready', '1');
      root.classList.add('is-live');
      CTStore.get('bridge/style').then(function (rec) { if (rec && rec.answers) ans = rec.answers; show(false); });
    });
  }

  function initDiagnose() {
    all('[data-diagnose]').forEach(function (root) {
      var save = root.getAttribute('data-diagnose'), opts = all('.dg__opt', root), anss = all('.dg__ans', root);
      var follows = all('.dg__follow', root), ress = all('.dg__res', root);
      var show = function (o, a, store) {
        opts.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-o') === o ? 'true' : 'false'); });
        anss.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-o') === o && b.getAttribute('data-a') === a ? 'true' : 'false'); });
        follows.forEach(function (f) { f.hidden = f.getAttribute('data-o') !== o; });
        var rid = a !== null && a !== undefined ? o + '-' + a : o, hit = null;
        ress.forEach(function (r) { var on = o !== null && r.getAttribute('data-res') === rid; r.hidden = !on; if (on) hit = r; });
        if (store && save && hit) {
          CTStore.set('bridge/' + save, { values: { issue: hit.getAttribute('data-issue'), next: hit.getAttribute('data-change'), area: hit.getAttribute('data-area') }, pick: [o, a], updatedAt: new Date().toISOString() })
            .then(function () { fillFrom(); });
        }
      };
      opts.forEach(function (b) { b.addEventListener('click', function () { var o = b.getAttribute('data-o'); var hasF = follows.some(function (f) { return f.getAttribute('data-o') === o; }); show(o, null, !hasF); }); });
      anss.forEach(function (b) { b.addEventListener('click', function () { show(b.getAttribute('data-o'), b.getAttribute('data-a'), true); }); });
      var rs = root.querySelector('.dg__reset');
      if (rs) rs.addEventListener('click', function () { show(null, null, false); if (save) CTStore.remove('bridge/' + save); if (opts[0]) opts[0].focus(); });
      root.classList.add('is-live');
      if (save) CTStore.get('bridge/' + save).then(function (rec) { if (rec && rec.pick) show(rec.pick[0], rec.pick[1], false); });
    });
  }

  function initRoom() {
    all('[data-hero="room"]').forEach(function (root) {
      var cues = all('.rm__cue', root), vs = all('.rm__voice[data-i]', root), v0 = root.querySelector('.rm__voice--0');
      root.classList.add('is-live');
      cues.forEach(function (b) {
        b.addEventListener('click', function () {
          var i = b.getAttribute('data-i');
          cues.forEach(function (x) { x.setAttribute('aria-pressed', x === b ? 'true' : 'false'); });
          vs.forEach(function (p) { p.hidden = p.getAttribute('data-i') !== i; });
          if (v0) v0.hidden = true;
          root.setAttribute('data-on', i);
        });
      });
    });
  }

  function initJoin() {
    all('[data-hero="joinin"]').forEach(function (root) {
      var tabs = all('.jn__tab', root), sw = root.querySelector('.jn__reset');
      root.classList.add('is-live');
      tabs.forEach(function (t) { t.addEventListener('click', function () { root.setAttribute('data-p', t.getAttribute('data-p')); tabs.forEach(function (x) { x.setAttribute('aria-pressed', x === t ? 'true' : 'false'); }); }); });
      if (sw) sw.addEventListener('change', function () { root.setAttribute('data-m', sw.checked ? 'on' : 'off'); });
    });
  }

  function initBridge() {
    all('[data-bridge-read]').forEach(function (root) {
      var labels = {}; try { labels = JSON.parse(root.getAttribute('data-labels')) || {}; } catch (e) { labels = {}; }
      var state = root.querySelector('.br__state'), list = all('.br__c', root);
      Promise.all([CTStore.get('bridge/style'), CTStore.get('bridge/need')]).then(function (r) {
        var st = r[0], nd = r[1];
        if (!st || !st.primary) { if (state) state.textContent = state.getAttribute('data-empty'); return; }
        var needs = (nd && nd.labels) || [];
        var score = function (li) {
          var s = 0, ls = li.getAttribute('data-style'), ln = (li.getAttribute('data-needs') || '').split('|');
          if (ls === st.primary) s += 4; else if (ls === st.secondary) s += 2;
          needs.forEach(function (n) { if (ln.indexOf(n) >= 0) s += 1; });
          return s;
        };
        var ranked = list.slice().sort(function (a, b) { return score(b) - score(a); });
        list.forEach(function (li) { li.hidden = true; li.classList.remove('is-pick'); });
        ranked.slice(0, 3).forEach(function (li) { li.hidden = false; li.classList.add('is-pick'); li.parentNode.appendChild(li); });
        if (state) state.textContent = 'あなたの診断（主軸 ' + st.primary + (labels[st.primary] ? '：' + labels[st.primary] : '') + (st.secondary ? '／サブ ' + st.secondary : '') + (needs.length ? '／視聴者の欲しいもの：' + needs.join('・') : '') + '）から選んだ3つです。';
        root.classList.add('is-bridged');
      });
    });
  }

  var REVEAL = '.kb__book, .oc__say, .ov, .or, .sec__head, .sec > .b, .sec__bridge, .pro__head, .cn__h, .cn__item, .loop, .sum__h, .goal, .nx__next';
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

  function init() { initFilter(); initSaves(); initCopy(); initToc(); initCompare(); initChat(); initVersus(); initBuilder(); initTimeline(); initSwitch(); initIdeaBank(); initLightLab(); initBgBuilder(); initLaunch(); initPromise(); initPanel(); initCompass(); initDiagnose(); initRoom(); initJoin(); initBridge(); initRecall(); fillFrom(); initSuggest(); initLights(); initReveal(); }
  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init); else init();
})(window);
