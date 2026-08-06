/**
 * Fuzzy autofill for the person search on works_together.
 *
 * ⛑ THIS IS SOURCE. It lives in `assets/`, NOT in `docs/assets/`, because the
 * bundler wipes and regenerates docs/ on every build -- the first version of
 * this file was written straight into docs/assets/ and the next bundle deleted
 * it. `scripts/postbuild.sh` copies it in and adds the script tag.
 *
 * WHY AN ATTACHED SCRIPT AND NOT A COMPONENT. That page is Lloyd's: it has no
 * custom .jsx and is drawn by Malloy's built-in table renderer. Giving it a
 * bespoke React component would mean redrawing his table, which the charter's
 * style ruling calls a redesign of his work. This attaches to the input he
 * ALREADY renders and adds a dropdown beside it. His markup, his styles, his
 * table, untouched.
 *
 * WHY NOT JUST FILL HIS <datalist>. He declares
 * `suggest{query=name_options dimension=name}` on the NAME given, so he wanted
 * suggestions; measured 2026-08-05, that datalist ships with ONE option (the
 * current value) and nothing appears. But a native datalist is filtered by the
 * BROWSER on a substring of what you typed, so "mikel cain" could never reach
 * Michael Caine through it however well it were populated. Fuzzy needs our own
 * list, which is what this draws.
 */
(function () {
  "use strict";
  var INPUT_SEL = 'input[list="dash-options-NAME"]';
  var LIST_ID = "person-autofill-list";
  var idx = null, loading = false, box = null, hits = [], cursor = 0;

  // Kept, not debug scaffolding: the suite asserts the index actually loaded,
  // and without it the only symptom of a broken fetch is an absent dropdown --
  // indistinguishable from "no matches".
  window.__personAutofill = {
    state: function () {
      return { loaded: !!idx, people: idx ? idx.entries.length : 0, loading: loading };
    },
  };

  function norm(s) {
    return String(s || "").normalize("NFD").replace(/[̀-ͯ]/g, "")
      .toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  }

  // Bounded Levenshtein with an early exit -- an unbounded distance over 16k
  // names per keystroke is the difference between a dropdown and a stutter.
  function within(a, b, budget) {
    if (a === b) return 0;
    if (Math.abs(a.length - b.length) > budget) return -1;
    var prev = [], cur = [], i, j;
    for (j = 0; j <= b.length; j++) prev[j] = j;
    for (i = 1; i <= a.length; i++) {
      cur[0] = i;
      var best = i;
      for (j = 1; j <= b.length; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
        if (cur[j] < best) best = cur[j];
      }
      if (best > budget) return -1;
      for (j = 0; j <= b.length; j++) prev[j] = cur[j];
    }
    return prev[b.length] <= budget ? prev[b.length] : -1;
  }

  // Calibrated against the stated case: "mikel" -> "michael" is THREE edits over
  // a 7-character word, and a flat budget of 2 rejected it.
  function budgetFor(n) { return n <= 3 ? 0 : Math.min(3, Math.floor(n / 2)); }

  // People only. This box searches Lloyd's `name` dimension; offering film
  // titles in it would answer a question the page cannot ask.
  function build(rows) {
    var entries = [], byPrefix = {};
    rows.forEach(function (r) {
      if (r[1] !== "p") return;
      var n = norm(r[0]);
      var e = { text: r[0], norm: n, tokens: n.split(" ").filter(Boolean), votes: Number(r[4] || 0) };
      var at = entries.push(e) - 1, seen = {};
      e.tokens.forEach(function (t) {
        var pfx = t.slice(0, 2);
        if (pfx.length < 2 || seen[pfx]) return;
        seen[pfx] = 1;
        (byPrefix[pfx] = byPrefix[pfx] || []).push(at);
      });
    });
    return { entries: entries, byPrefix: byPrefix };
  }

  function tokenScore(q, tok) {
    if (q === tok) return 4;
    if (tok.indexOf(q) === 0) return 3 + q.length / tok.length;
    var d = within(q, tok, budgetFor(Math.max(q.length, tok.length)));
    if (d === 0) return 4;
    if (d > 0) return 2.5 - d * 0.4;
    if (q.length >= 3 && tok.indexOf(q) !== -1) return 1.5;
    return 0;
  }

  // Every query token must match something, or "brad pi" returns people called
  // Brad -- the second token is the one doing the work.
  function suggest(query, k) {
    var qn = norm(query);
    if (!qn || !idx) return [];
    var qs = qn.split(" ").filter(Boolean), pool = {}, out = [];
    qs.forEach(function (q) {
      var bucket = idx.byPrefix[q.slice(0, 2)];
      if (bucket) bucket.forEach(function (i) { pool[i] = 1; });
    });
    Object.keys(pool).forEach(function (i) {
      var e = idx.entries[i], total = 0, ok = true;
      qs.forEach(function (q) {
        if (!ok) return;
        var best = 0;
        e.tokens.forEach(function (t) { var sc = tokenScore(q, t); if (sc > best) best = sc; });
        if (!best) ok = false; else total += best;
      });
      if (!ok) return;
      if (e.norm === qn) total += 6;
      else if (e.norm.indexOf(qn) === 0) total += 2;
      total += (Math.log(e.votes + 10) / Math.LN10) * 0.6;
      out.push({ text: e.text, score: total, votes: e.votes });
    });
    out.sort(function (a, b) { return b.score - a.score || b.votes - a.votes; });
    return out.slice(0, k || 8);
  }

  function load() {
    if (idx || loading) return;
    loading = true;
    fetch("data/suggest.json")
      .then(function (r) { if (!r.ok) throw new Error(String(r.status)); return r.json(); })
      .then(function (rows) { idx = build(rows); })
      // An accelerator, never the only way in: on failure his input still works.
      .catch(function () { idx = null; })
      .then(function () { loading = false; });
  }

  // Setting .value directly does not notify the framework listening on the
  // input; the native setter plus an input event is what a real keystroke does.
  function setValue(input, v) {
    var desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (desc && desc.set) desc.set.call(input, v); else input.value = v;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // ⛔ TWO OPERATIONS, NOT ONE, and conflating them was a real bug. `close()`
  // cleared `hits` as well as removing the node, and `render()` opened by
  // calling it -- so the length check on the very next line always saw zero.
  // The handler computed 8 correct suggestions eleven times and drew none of
  // them. Tearing down the DOM is not the same act as forgetting the results.
  function removeBox() {
    if (box) box.remove();
    var stray = document.getElementById(LIST_ID);
    if (stray) stray.remove();
    box = null;
  }
  function close() { removeBox(); hits = []; cursor = 0; }

  function render(input) {
    removeBox();
    if (!hits.length) return;
    box = document.createElement("ul");
    box.setAttribute("role", "listbox");
    box.id = LIST_ID;
    // ⛔ ANCHORED TO <body> WITH FIXED COORDINATES, not appended beside the
    // input: the dashboard re-renders that input's subtree on every keystroke,
    // so a list appended to its parent is destroyed as fast as it is created.
    var r = input.getBoundingClientRect();
    box.style.cssText =
      "position:fixed;z-index:2147483000;left:" + Math.round(r.left) + "px;top:" + Math.round(r.bottom + 4) + "px;" +
      "margin:0;padding:4px;list-style:none;min-width:" + Math.max(220, Math.round(r.width)) + "px;" +
      "max-height:300px;overflow-y:auto;border-radius:8px;" +
      "background:var(--dash-control-bg,#fff);border:1px solid var(--dash-border,#ccc);" +
      "box-shadow:0 8px 24px rgba(0,0,0,.16);font-size:13px;color:var(--dash-fg,#1a1a1a)";
    hits.forEach(function (h, i) {
      var li = document.createElement("li");
      li.setAttribute("role", "option");
      li.textContent = h.text;
      li.style.cssText = "padding:5px 8px;border-radius:5px;cursor:pointer;white-space:nowrap;" +
        (i === cursor ? "background:var(--dash-border,#eee);font-weight:600;" : "");
      li.addEventListener("mouseenter", function () { cursor = i; render(input); });
      li.addEventListener("mousedown", function (e) { e.preventDefault(); setValue(input, h.text); close(); });
      box.appendChild(li);
    });
    document.body.appendChild(box);
  }

  // ⛔ EVENT DELEGATION, NOT PER-NODE LISTENERS. The dashboard re-renders that
  // input as you type, so handlers bound to the node are thrown away with it:
  // the index loaded, the matcher returned Michael Caine when called directly,
  // and not one keystroke ever reached the handler.
  function target(e) {
    var t = e.target;
    return t && t.matches && t.matches(INPUT_SEL) ? t : null;
  }
  document.addEventListener("focusin", function (e) { if (target(e)) load(); }, true);
  document.addEventListener("input", function (e) {
    var input = target(e);
    if (!input) return;
    if (!idx || input.value.trim().length < 2) { close(); return; }
    hits = suggest(input.value, 8);
    cursor = 0;
    render(input);
  }, true);
  document.addEventListener("focusout", function (e) {
    if (target(e)) window.setTimeout(close, 150);
  }, true);
  document.addEventListener("keydown", function (e) {
    var input = target(e);
    if (!input || !hits.length) return;
    if (e.key === "ArrowDown") { e.preventDefault(); cursor = Math.min(cursor + 1, hits.length - 1); render(input); }
    else if (e.key === "ArrowUp") { e.preventDefault(); cursor = Math.max(cursor - 1, 0); render(input); }
    else if (e.key === "Enter") { e.preventDefault(); setValue(input, hits[cursor].text); close(); }
    else if (e.key === "Escape") { close(); }
  }, true);

  // Load as soon as the control exists, so the first keystroke is not the one
  // that starts a 1.6 MB fetch. The control appears after the dashboard renders
  // and can be replaced, so watch rather than query once.
  function scan() { if (document.querySelector(INPUT_SEL)) load(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", scan);
  else scan();
  new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
})();
