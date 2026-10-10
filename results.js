(function () {
  "use strict";

  /* ================= config ================= */
  // Paste the Google Apps Script web app URL (ends in /exec) here.
  // While empty, results are saved only in this browser (local mode).
  var API_URL = "https://script.google.com/macros/s/AKfycbycGyn57nRnjDmp7v9mpv2KMdn_aeh0B2afBjaxAIaXV8d6CY2g4blrPaahLYWuIMCJKw/exec";
  var POLL_MS = 10000;
  var LOCAL_KEY = "tennis-results-local-v1";
  var TAB_KEY = "tennis-page-v1";

  var GROUPS = [
    { id: "A", name: "A조", court: 1, color: "#2f5a8a", players: ["정세용", "하동원", "신동한"] },
    { id: "B", name: "B조", court: 2, color: "#3d7058", players: ["이정희", "황보하은", "오민석"] },
    { id: "C", name: "C조", court: 3, color: "#6b4a82", players: ["박도영", "신동석", "노준호"] },
    { id: "D", name: "D조", court: 4, color: "#a8532f", players: ["류동훈", "이승민", "이경신"] }
  ];
  // Round-robin order for a group of 3: [firstIdx, secondIdx] per round.
  var PAIRS = [[0, 1], [0, 2], [1, 2]];
  var ROUNDS = [
    { n: 1, time: "09:00–09:30" },
    { n: 2, time: "09:35–10:05" },
    { n: 3, time: "10:10–10:40" }
  ];
  var MATCHES = [];
  GROUPS.forEach(function (g) {
    PAIRS.forEach(function (pr, r) {
      MATCHES.push({
        id: g.id + (r + 1), group: g.id, round: r + 1, court: g.court,
        p1: g.players[pr[0]], p2: g.players[pr[1]]
      });
    });
  });
  var BY_ID = {};
  MATCHES.forEach(function (m) { BY_ID[m.id] = m; });

  /* ================= state ================= */
  var results = {};          // matchId -> {g1,g2,tb1,tb2,ts}
  var lastSync = null;
  var syncError = false;
  var formMatchId = "";
  var formG = [0, 0];
  var formTb = ["", ""];
  var pollTimer = null;

  var $ = function (id) { return document.getElementById(id); };
  var el = {
    navScore: $("nav-score"), navResults: $("nav-results"),
    pageScore: $("page-score"), pageResults: $("page-results"),
    rounds: $("r-rounds"), tables: $("r-tables"), sync: $("r-sync"), banner: $("r-banner"),
    sheet: $("r-sheet"), sel: $("f-match"), err: $("f-err"), save: $("f-save"),
    name0: $("f-name0"), name1: $("f-name1"), g0: $("f-g0"), g1: $("f-g1"),
    tbRow: $("f-tbrow"), tb0: $("f-tb0"), tb1: $("f-tb1"), note: $("f-note"),
    toast: $("r-toast")
  };

  function num(v) { v = parseInt(v, 10); return isFinite(v) && v >= 0 ? v : 0; }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function hhmm(d) { return pad(d.getHours()) + ":" + pad(d.getMinutes()); }

  /* ================= storage ================= */
  function normalizeRows(rows) {
    var out = {};
    (rows || []).forEach(function (r) {
      if (!r || !BY_ID[r.matchId]) return;
      var g1 = num(r.g1), g2 = num(r.g2);
      out[r.matchId] = {
        g1: g1, g2: g2,
        tb1: r.tb1 === "" || r.tb1 == null ? null : num(r.tb1),
        tb2: r.tb2 === "" || r.tb2 == null ? null : num(r.tb2),
        ts: r.timestamp || r.ts || ""
      };
    });
    return out; // later rows overwrite earlier rows for the same match
  }

  function loadLocal() {
    try {
      var raw = localStorage.getItem(LOCAL_KEY);
      if (raw) results = JSON.parse(raw) || {};
    } catch (e) { results = {}; }
  }
  function saveLocal() {
    try { localStorage.setItem(LOCAL_KEY, JSON.stringify(results)); } catch (e) { /* ignore */ }
  }

  function fetchJson(url) {
    return fetch(url, { method: "GET", cache: "no-store" }).then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    });
  }

  function refresh() {
    if (!API_URL) { lastSync = new Date(); renderAll(); return Promise.resolve(); }
    return fetchJson(API_URL + "?action=list&t=" + Date.now()).then(function (data) {
      if (!data || !data.ok) throw new Error("bad response");
      results = normalizeRows(data.rows);
      lastSync = new Date(); syncError = false;
      saveLocal();
      renderAll();
    }).catch(function () {
      syncError = true; renderAll();
    });
  }

  function submitResult(row) {
    if (!API_URL) {
      results[row.matchId] = { g1: row.g1, g2: row.g2, tb1: row.tb1, tb2: row.tb2, ts: new Date().toISOString() };
      saveLocal(); renderAll();
      return Promise.resolve();
    }
    var q = "?action=submit&matchId=" + encodeURIComponent(row.matchId) +
      "&g1=" + row.g1 + "&g2=" + row.g2 +
      "&tb1=" + (row.tb1 == null ? "" : row.tb1) + "&tb2=" + (row.tb2 == null ? "" : row.tb2) +
      "&t=" + Date.now();
    return fetchJson(API_URL + q).then(function (data) {
      if (!data || !data.ok) throw new Error((data && data.error) || "저장 실패");
      return refresh();
    });
  }

  /* ================= standings ================= */
  function groupStats(g) {
    var st = {};
    g.players.forEach(function (p) { st[p] = { name: p, p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0 }; });
    MATCHES.forEach(function (m) {
      if (m.group !== g.id || !results[m.id]) return;
      var r = results[m.id], a = st[m.p1], b = st[m.p2];
      a.p++; b.p++;
      a.gf += r.g1; a.ga += r.g2; b.gf += r.g2; b.ga += r.g1;
      if (r.g1 > r.g2) { a.w++; b.l++; } else if (r.g2 > r.g1) { b.w++; a.l++; } else { a.d++; b.d++; }
    });
    return st;
  }

  // wins → head-to-head → game difference → games won → (tie: draw lots)
  function rankGroup(g) {
    var st = groupStats(g);
    var matches = MATCHES.filter(function (m) { return m.group === g.id && results[m.id]; });

    function bucketBy(list, keyFn) {
      var keys = {};
      list.forEach(function (p) { var k = keyFn(p); (keys[k] = keys[k] || []).push(p); });
      return Object.keys(keys).map(Number).sort(function (a, b) { return b - a; })
        .map(function (k) { return keys[k]; });
    }
    function h2hWins(p, set) {
      var w = 0;
      matches.forEach(function (m) {
        if (set.indexOf(m.p1) < 0 || set.indexOf(m.p2) < 0) return;
        var r = results[m.id];
        if (m.p1 === p && r.g1 > r.g2) w++;
        if (m.p2 === p && r.g2 > r.g1) w++;
      });
      return w;
    }
    function resolve(bucket) {
      if (bucket.length === 1) return [bucket];
      var names = bucket.map(function (s) { return s.name; });
      var h = bucketBy(bucket, function (s) { return h2hWins(s.name, names); });
      if (h.length > 1) {
        return h.reduce(function (acc, sub) { return acc.concat(resolve(sub)); }, []);
      }
      var out = [];
      bucketBy(bucket, function (s) { return s.gf - s.ga; }).forEach(function (gd) {
        bucketBy(gd, function (s) { return s.gf; }).forEach(function (gf) { out.push(gf); });
      });
      return out;
    }

    var all = g.players.map(function (p) { return st[p]; });
    var ordered = [];
    bucketBy(all, function (s) { return s.w; }).forEach(function (wb) {
      resolve(wb).forEach(function (t) { ordered.push(t); });
    });
    var complete = matches.length === 3;
    var rows = [], pos = 1;
    ordered.forEach(function (tie) {
      tie.forEach(function (s) {
        rows.push({ s: s, rank: pos, lots: tie.length > 1 && complete });
      });
      pos += tie.length;
    });
    return rows;
  }

  /* ================= rendering ================= */
  function h(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function groupOf(id) { return GROUPS.filter(function (g) { return g.id === id; })[0]; }

  function renderRounds() {
    el.rounds.textContent = "";
    ROUNDS.forEach(function (rd) {
      var ms = MATCHES.filter(function (m) { return m.round === rd.n; });
      var done = ms.filter(function (m) { return results[m.id]; }).length;
      var sec = h("section", "r-round");
      var head = h("div", "r-round-head");
      head.appendChild(h("h2", null, rd.n + "라운드"));
      head.appendChild(h("span", "r-meta", rd.time + " · " + done + "/" + ms.length + " 완료"));
      sec.appendChild(head);
      ms.forEach(function (m) {
        var g = groupOf(m.group), r = results[m.id];
        var card = h("button", "r-card" + (r ? " done" : ""));
        card.type = "button";
        card.style.setProperty("--bar", g.color);
        card.setAttribute("aria-label", g.name + " " + m.p1 + " 대 " + m.p2 + (r ? " " + r.g1 + "대" + r.g2 : " 점수 입력"));
        var top = h("div", "r-card-top");
        top.appendChild(h("span", null, "코트 " + m.court));
        top.appendChild(h("span", null, g.name));
        card.appendChild(top);
        [[m.p1, r && r.g1, r && r.g1 > r.g2, r && r.tb1], [m.p2, r && r.g2, r && r.g2 > r.g1, r && r.tb2]]
          .forEach(function (row) {
            var line = h("div", "r-line" + (row[2] ? " win" : ""));
            line.appendChild(h("span", "r-pname", row[0]));
            var box = h("span", "r-score" + (r ? " set" : ""), r ? String(row[1]) : "");
            if (r && row[3] != null && r.tb1 != null && r.tb2 != null) {
              var sup = h("sup", null, String(row[3]));
              box.appendChild(sup);
            }
            line.appendChild(box);
            card.appendChild(line);
          });
        if (r && r.g1 === r.g2) card.appendChild(h("div", "r-tag", "무승부 (시간 종료)"));
        else if (r && Math.max(r.g1, r.g2) < 4) card.appendChild(h("div", "r-tag", "시간 종료"));
        card.addEventListener("click", function () { openForm({ matchId: m.id }); });
        sec.appendChild(card);
      });
      el.rounds.appendChild(sec);
    });
  }

  function renderTables() {
    el.tables.textContent = "";
    el.tables.appendChild(h("h2", "r-section-title", "조별 순위"));
    GROUPS.forEach(function (g) {
      var rows = rankGroup(g);
      var played = MATCHES.filter(function (m) { return m.group === g.id && results[m.id]; }).length;
      var hasDraw = rows.some(function (x) { return x.s.d > 0; });
      var card = h("section", "r-group");
      card.style.setProperty("--bar", g.color);
      var head = h("div", "r-group-head");
      head.appendChild(h("h3", null, g.name));
      head.appendChild(h("span", "r-meta", played + "/3 경기"));
      card.appendChild(head);

      var tbl = h("table", "r-table");
      var cols = ["순위", "선수", "경기", "승"].concat(hasDraw ? ["무"] : []).concat(["패", "게임 득실"]);
      var thead = h("thead"), trh = h("tr");
      cols.forEach(function (c, i) { var th = h("th", i === 1 ? "left" : null, c); th.scope = "col"; trh.appendChild(th); });
      thead.appendChild(trh); tbl.appendChild(thead);
      var tb = h("tbody");
      rows.forEach(function (x) {
        var tr = h("tr");
        tr.appendChild(h("td", "rk", String(x.rank)));
        var nm = h("td", "left nm", x.s.name);
        if (x.lots) nm.appendChild(h("span", "r-lots", "추첨"));
        tr.appendChild(nm);
        tr.appendChild(h("td", null, String(x.s.p)));
        tr.appendChild(h("td", null, String(x.s.w)));
        if (hasDraw) tr.appendChild(h("td", null, String(x.s.d)));
        tr.appendChild(h("td", null, String(x.s.l)));
        var d = x.s.gf - x.s.ga;
        tr.appendChild(h("td", null, (d > 0 ? "+" : "") + d));
        tb.appendChild(tr);
      });
      tbl.appendChild(tb);
      card.appendChild(tbl);
      el.tables.appendChild(card);
    });
    el.tables.appendChild(h("p", "r-rule",
      "순위 기준: 승수 → 상대전적 → 게임 득실차 → 득게임 → 추첨"));
  }

  function renderStatus() {
    if (!API_URL) {
      el.banner.hidden = false;
      el.banner.textContent = "공유 저장소가 아직 연결되지 않았습니다. 지금은 이 기기에만 저장됩니다.";
    } else if (syncError) {
      el.banner.hidden = false;
      el.banner.textContent = "서버에 연결할 수 없습니다. 잠시 후 다시 시도합니다.";
    } else {
      el.banner.hidden = true;
    }
    el.sync.textContent = lastSync ? "갱신 " + hhmm(lastSync) : "불러오는 중…";
  }

  function renderAll() {
    renderRounds(); renderTables(); renderStatus();
  }

  /* ================= form ================= */
  function validate() {
    var a = formG[0], b = formG[1];
    if (!formMatchId) return "경기를 선택하세요.";
    if (a > 4 || b > 4) return "게임 수는 4를 넘을 수 없습니다.";
    if (a === 4 && b === 4) return "두 선수 모두 4게임일 수 없습니다.";
    return "";
  }

  function tbVisible() {
    return (formG[0] === 4 && formG[1] === 3) || (formG[0] === 3 && formG[1] === 4);
  }

  function noteText() {
    var a = formG[0], b = formG[1];
    if (Math.max(a, b) === 4) return Math.min(a, b) === 3 ? "3-3 이후 7포인트 타이브레이크로 결정" : "4게임 선취";
    if (a === b) return "시간 종료 · 무승부로 기록됩니다";
    return "30분 시간 종료 · 게임을 더 딴 선수가 승리";
  }

  function renderForm() {
    var m = BY_ID[formMatchId];
    el.name0.textContent = m ? m.p1 : "선수 1";
    el.name1.textContent = m ? m.p2 : "선수 2";
    el.g0.textContent = formG[0];
    el.g1.textContent = formG[1];
    el.tbRow.hidden = !tbVisible();
    el.tb0.value = formTb[0]; el.tb1.value = formTb[1];
    var err = validate();
    el.err.textContent = err;
    el.note.textContent = err ? "" : noteText();
    el.save.disabled = !!err;
    el.sel.value = formMatchId;
  }

  function buildSelect() {
    el.sel.textContent = "";
    var first = h("option", null, "경기 선택…"); first.value = ""; el.sel.appendChild(first);
    ROUNDS.forEach(function (rd) {
      var og = document.createElement("optgroup");
      og.label = rd.n + "라운드 · " + rd.time;
      MATCHES.filter(function (m) { return m.round === rd.n; }).forEach(function (m) {
        var o = h("option", null, groupOf(m.group).name + " · " + m.p1 + " vs " + m.p2);
        o.value = m.id; og.appendChild(o);
      });
      el.sel.appendChild(og);
    });
  }

  function openForm(opts) {
    opts = opts || {};
    formMatchId = opts.matchId || "";
    var r = formMatchId && results[formMatchId];
    formG = r ? [r.g1, r.g2] : (opts.games || [0, 0]).slice();
    formTb = r && r.tb1 != null ? [String(r.tb1), String(r.tb2)] : ["", ""];
    if (opts.games) { formG = opts.games.slice(); formTb = ["", ""]; }
    el.sheet.hidden = false;
    document.body.classList.add("sheet-open");
    renderForm();
    el.sel.focus({ preventScroll: true });
  }
  function closeForm() {
    el.sheet.hidden = true;
    document.body.classList.remove("sheet-open");
  }

  function toast(msg) {
    el.toast.textContent = msg; el.toast.hidden = false;
    clearTimeout(toast.t);
    toast.t = setTimeout(function () { el.toast.hidden = true; }, 2600);
  }

  // Match scorekeeper names (left, right) to a scheduled match, in either order.
  function matchFromNames(names) {
    var a = (names[0] || "").trim(), b = (names[1] || "").trim();
    for (var i = 0; i < MATCHES.length; i++) {
      var m = MATCHES[i];
      if (m.p1 === a && m.p2 === b) return { id: m.id, swap: false };
      if (m.p1 === b && m.p2 === a) return { id: m.id, swap: true };
    }
    return null;
  }

  function fromScorekeeper() {
    var sk = window.tennisScorekeeper && window.tennisScorekeeper.read();
    if (!sk) return;
    var found = matchFromNames(sk.names);
    var games = sk.games.slice();
    if (found && found.swap) games = [games[1], games[0]];
    formG = [Math.min(games[0], 4), Math.min(games[1], 4)];
    if (found) formMatchId = found.id;
    formTb = ["", ""];
    renderForm();
    toast(found ? "스코어키퍼 점수를 불러왔습니다." : "선수 이름이 대진표와 달라 경기를 직접 선택해 주세요.");
  }

  function bindForm() {
    el.sel.addEventListener("change", function () {
      formMatchId = el.sel.value;
      var r = formMatchId && results[formMatchId];
      if (r) { formG = [r.g1, r.g2]; formTb = r.tb1 != null ? [String(r.tb1), String(r.tb2)] : ["", ""]; }
      renderForm();
    });
    [].forEach.call(document.querySelectorAll("[data-step]"), function (b) {
      b.addEventListener("click", function () {
        var i = +b.dataset.side, d = +b.dataset.step;
        formG[i] = Math.max(0, Math.min(4, formG[i] + d));
        renderForm();
      });
    });
    $("f-swap").addEventListener("click", function () {
      formG = [formG[1], formG[0]];
      formTb = [formTb[1], formTb[0]];
      renderForm();
    });
    $("f-load").addEventListener("click", fromScorekeeper);
    $("f-cancel").addEventListener("click", closeForm);
    el.sheet.addEventListener("click", function (e) { if (e.target === el.sheet) closeForm(); });
    el.tb0.addEventListener("input", function () { formTb[0] = el.tb0.value; });
    el.tb1.addEventListener("input", function () { formTb[1] = el.tb1.value; });
    el.save.addEventListener("click", function () {
      if (validate()) return;
      var existing = results[formMatchId];
      if (existing && !window.confirm("이미 입력된 경기입니다. 새 점수로 덮어쓸까요?")) return;
      var tb = tbVisible() && formTb[0] !== "" && formTb[1] !== "";
      var row = {
        matchId: formMatchId, g1: formG[0], g2: formG[1],
        tb1: tb ? num(formTb[0]) : null, tb2: tb ? num(formTb[1]) : null
      };
      el.save.disabled = true;
      submitResult(row).then(function () {
        closeForm(); toast("저장되었습니다.");
      }).catch(function () {
        el.err.textContent = "저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.";
        el.save.disabled = false;
      });
    });
  }

  /* ================= page switching ================= */
  function showPage(p) {
    var onRes = p === "results";
    el.pageScore.hidden = onRes;
    el.pageResults.hidden = !onRes;
    el.navScore.setAttribute("aria-selected", onRes ? "false" : "true");
    el.navResults.setAttribute("aria-selected", onRes ? "true" : "false");
    document.body.classList.toggle("on-results", onRes);
    try { localStorage.setItem(TAB_KEY, p); } catch (e) { /* ignore */ }
    try { history.replaceState(null, "", onRes ? "#results" : location.pathname + location.search); } catch (e) { /* ignore */ }
    if (onRes) refresh();
  }

  function startPolling() {
    clearInterval(pollTimer);
    pollTimer = setInterval(function () {
      if (!document.hidden && !el.pageResults.hidden && el.sheet.hidden) refresh();
    }, POLL_MS);
  }

  /* ================= init ================= */
  loadLocal();
  buildSelect();
  bindForm();
  el.navScore.addEventListener("click", function () { showPage("score"); });
  el.navResults.addEventListener("click", function () { showPage("results"); });
  $("sk-send").addEventListener("click", function () {
    var sk = window.tennisScorekeeper.read();
    var found = matchFromNames(sk.names);
    var games = sk.games.slice();
    if (found && found.swap) games = [games[1], games[0]];
    showPage("results");
    openForm({ matchId: found ? found.id : "", games: [Math.min(games[0], 4), Math.min(games[1], 4)] });
  });
  $("r-add").addEventListener("click", function () { openForm({}); });
  $("r-refresh").addEventListener("click", function () { refresh(); });
  document.addEventListener("visibilitychange", function () { if (!document.hidden && !el.pageResults.hidden) refresh(); });

  var start = "score";
  try { if (localStorage.getItem(TAB_KEY) === "results") start = "results"; } catch (e) { /* ignore */ }
  if (location.hash === "#results") start = "results";
  renderAll();
  showPage(start);
  startPolling();
})();
