/* Shared drill engine for every training-ground session page.

   A page includes this file, then calls:
     FAL.squadSheet()          draw the three table cards (FAL.TABLES) into #tables
     FAL.session({...})        render the drills, wire the buttons, load the engine
     FAL.heroMap(rows)         draw the hero shot map from [x, y, xg, isGoal] rows

   The engine is the only language-specific part. It is an object with:
     load(status)  async; loads the language and the data. status(text) updates the bar.
     run(code)     async; runs learner code and resolves to {columns, values, output},
                   or throws an Error whose message is shown to the learner.
   Results are compared by value, so SQL, pandas and dplyr answers all go through the same checker. */
(function(){
const FAL = window.FAL = {};

/* ---------- small helpers ---------- */
// Escape text before it goes into innerHTML (results, drafts and errors are user-controlled)
const esc = FAL.esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const $ = id => document.getElementById(id);
const fmtN = n => Number(n).toLocaleString("en-AU");

/* ---------- the squad sheet: what each table holds, with a short note per column ---------- */
FAL.TABLES = {
  matches: {about:"One row per match: 48 group games and 16 knockout games.", cols:{
    match_id:"id", match_date:"YYYY-MM-DD", kick_off:"local time", stage:"'Group Stage', 'Final'…", match_week:"1–7",
    home_team:"", away_team:"", home_score:"after extra time", away_score:"after extra time", stadium:"", referee:""}},
  players: {about:"One row per player in each squad's matchday lineups.", cols:{
    player_id:"id", player_name:"full name", nickname:"short name, or empty", team:"", jersey_number:"", country:""}},
  shots: {about:"One row per shot, penalty shootouts included.", cols:{
    shot_id:"id", match_id:"→ matches", team:"", player_id:"→ players", player:"full name", period:"1–4, 5 = shootout",
    minute:"", second:"", x:"0–120", y:"0–80", xg:"0–1", outcome:"'Goal', 'Saved', 'Off T'…",
    shot_type:"'Open Play', 'Penalty'…", body_part:"", technique:"", under_pressure:"1 or 0"}}
};
// One card per table; row counts arrive later through FAL.setRows
FAL.squadSheet = (tables = FAL.TABLES) => {
  $("tables").innerHTML = Object.entries(tables).map(([t, d]) =>
    `<div class="tcard"><h3>${t}<small data-rows="${t}"></small></h3><p>${d.about}</p><ul class="cols">${
      Object.entries(d.cols).map(([c, n]) => `<li><span>${c}</span><em>${esc(n)}</em></li>`).join("")}</ul></div>`).join("");
};
// counts: {matches: 64, players: 829, shots: 1494, shotsNoShootout: 1453}
FAL.setRows = counts => {
  for(const t of ["matches", "players", "shots"]){
    const el = document.querySelector(`[data-rows="${t}"]`);
    if(el && counts[t] != null) el.textContent = fmtN(counts[t]) + " rows";
  }
  if($("n-matches")) $("n-matches").textContent = counts.matches;
  if($("n-shots")) $("n-shots").textContent = fmtN(counts.shotsNoShootout);
};

/* ---------- every session, for the "All sessions" strip at the foot of each page ---------- */
FAL.SESSIONS = [
  {id:"sql-01",    lang:"SQL",    n:"01", title:"First touches",  what:"SELECT, WHERE, ORDER BY, GROUP BY and HAVING"},
  {id:"sql-02",    lang:"SQL",    n:"02", title:"Link-up play",   what:"Joins: matches, players and shots together"},
  {id:"python-01", lang:"Python", n:"01", title:"First touches",  what:"Session 01's questions, answered with pandas"},
  {id:"r-01",      lang:"R",      n:"01", title:"First touches",  what:"Session 01's questions, answered with dplyr"}
];
// current: this page's id, marked rather than linked
FAL.sessions = current => {
  $("sessions").innerHTML = FAL.SESSIONS.map(s => {
    const inner = `<small>${s.lang} · Session ${s.n}</small><b>${s.title}</b><span>${s.what}</span>`;
    return s.id === current ? `<div class="sess here" aria-current="page">${inner}<em>You're here</em></div>`
                            : `<a class="sess" href="../${s.id}/">${inner}</a>`;
  }).join("");
};

/* ---------- CSV: a small parser for the files in training/data (quoted fields allowed) ----------
   Returns an array of objects keyed by the header row. Numbers stay as strings; callers convert. */
FAL.parseCSV = text => {
  const rows = []; let row = [], field = "", q = false;
  for(let i = 0; i < text.length; i++){
    const c = text[i];
    if(q){ if(c === '"'){ if(text[i + 1] === '"'){ field += '"'; i++; } else q = false; } else field += c; }
    else if(c === '"') q = true;
    else if(c === ","){ row.push(field); field = ""; }
    else if(c === "\n"){ row.push(field); rows.push(row); row = []; field = ""; }
    else if(c !== "\r") field += c;
  }
  if(field || row.length){ row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
};

/* ---------- running and checking ---------- */
// Display a cell: missing values spelled out, decimals trimmed to at most 4 places
const fmtCell = (v, missing) => v === null ? missing : typeof v === "number" && !Number.isInteger(v) ? String(+v.toFixed(4)) : String(v);
// Render a result: printed output first, then the table, capped at 200 rows so a careless dump stays fast
function table(r, missing){
  const out = r.output ? `<pre class="stdout">${esc(r.output)}</pre>` : "";
  if(!r.columns.length) return out || `<div class="meta">It ran, but there's no table to show.</div>`;
  const shown = r.values.slice(0, 200);
  return out + `<div class="meta">${r.values.length} row${r.values.length === 1 ? "" : "s"}${r.values.length > 200 ? " · showing the first 200" : ""}</div>
    <table><thead><tr>${r.columns.map(c => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${
    shown.map(row => `<tr>${row.map(v => `<td class="${v === null ? "null" : typeof v === "number" ? "n" : ""}">${esc(fmtCell(v, missing))}</td>`).join("")}</tr>`).join("")}</tbody></table>`;
}
// For checking: numbers compared to 2 decimal places, so rounded and unrounded sums both pass;
// booleans count as 1/0 so SUM(x = 'Goal'), sum(x == "Goal") and a True/False column all agree
const norm = v => typeof v === "boolean" ? (v ? "1.00" : "0.00") : typeof v === "number" ? (Math.round(v * 100) / 100).toFixed(2) : v === null ? "∅" : String(v);
const rowKey = row => row.map(norm).join("␟");   // one string per row, joined on a character the data won't contain
// Compare the learner's result with the solution's by value (column names ignored).
// Returns "" on a match, or a message saying what's off: columns, row count, then values.
function compare(got, want, ordered){
  if(!got.columns.length) return "Your code didn't produce a table or value to check.";
  if(got.columns.length !== want.columns.length)
    return `You returned ${got.columns.length} column${got.columns.length === 1 ? "" : "s"}; the answer has ${want.columns.length}.`;
  if(got.values.length !== want.values.length)
    return `You returned ${got.values.length} row${got.values.length === 1 ? "" : "s"}; the answer has ${want.values.length}.`;
  let g = got.values.map(rowKey), w = want.values.map(rowKey);
  if(!ordered){ g = g.slice().sort(); w = w.slice().sort(); }   // compare as multisets when order is free
  for(let i = 0; i < w.length; i++) if(g[i] !== w[i])
    return ordered ? `Row ${i + 1} doesn't match. Check the filter, the column order and the sort.` : "Right number of rows, but some values differ. Check the filter and the column order.";
  return "";
}
// Ties can sit in any order, so a sorted drill checks that its sort key never goes the wrong way
// (with a little slack for rounded values)
function sortedBy(rows, key){
  for(let i = 1; i < rows.length; i++) if(key(rows[i]) > key(rows[i - 1]) + .011) return false;
  return true;
}

/* ---------- a session page ----------
   cfg.key       localStorage key, e.g. "fal-sql-01"
   cfg.drills    array of drills:
                   title/concept/task  what the learner sees
                   teach, eg           a one-line lesson and an example on a different question
                   start               what the editor holds before the learner types
                   hint, sol           revealed on request; sol is also run to produce the expected answer
                   ordered             true when rows must come back in exactly the solution's order
                   desc                for sorted drills with possible ties: a key the rows must never increase on
   cfg.engine    see the top of this file
   cfg.free      starter code for the free-play editor
   cfg.indent    what Tab inserts (Python likes four spaces)
   cfg.missing   how a missing value is shown: NULL, None or NA
   cfg.orderTip  the verdict when rows are right but the order is wrong
   cfg.onReady   async; called once the engine has loaded (row counts, hero map) */
FAL.session = cfg => {
  const D = cfg.drills, indent = cfg.indent || "  ", missing = cfg.missing || "NULL";

  /* storage (best effort): ticks and drafts live in this browser only. Private windows or blocked
     storage just mean nothing is remembered; the page still works. */
  let saved = {done:{}, drafts:{}};   // done: {d1: 1, …}; drafts: {d1: "…", free: "…"}
  try{ saved = Object.assign(saved, JSON.parse(localStorage.getItem(cfg.key)) || {}); }catch(e){}
  const persist = () => { try{ localStorage.setItem(cfg.key, JSON.stringify(saved)); }catch(e){} };

  // A textarea plus an empty actions row (buttons are added below). Restores a saved draft if there is one.
  const editorBlock = (id, start) => `<div class="editor"><label for="q-${id}" style="position:absolute;left:-9999px">Code for ${id}</label>
    <textarea id="q-${id}" spellcheck="false" autocapitalize="off" autocomplete="off">${esc(saved.drafts[id] ?? start)}</textarea>
    <div class="actions" data-id="${id}"></div></div>`;
  // One card per drill, ids d1…d8; hint, answer and verdict start hidden
  $("drill-list").innerHTML = D.map((d, i) => { const id = "d" + (i + 1); return `
    <article class="drill${saved.done[id] ? " done" : ""}" id="${id}">
      <div class="dhead"><div class="dnum">${String(i + 1).padStart(2, "0")}</div>
        <div class="concept">${d.concept}</div><h3>${d.title}</h3><p>${d.task}</p></div>
      <div class="teach">${d.teach}<pre>${esc(d.eg)}</pre></div>
      ${editorBlock(id, d.start)}
      <div class="hint" hidden>${d.hint}</div>
      <div class="solution" hidden>One answer:<pre>${esc(d.sol)}</pre></div>
      <div class="verdict" hidden></div>
      <div class="out" id="out-${id}"></div><div class="pad"></div>
    </article>`; }).join("");
  // Free play: the same editor with starter code, but no checker
  $("scratch").innerHTML = editorBlock("free", cfg.free) + `<div class="out" id="out-free"></div><div class="pad"></div>`;
  // Run and Check stay disabled until the engine has loaded; free play gets Run only
  document.querySelectorAll(".actions").forEach(a => {
    a.innerHTML = `<button class="run" data-act="run" disabled>Run</button>` +
      (a.dataset.id === "free" ? "" : `<button data-act="check" disabled>Check</button><button data-act="hint">Hint</button><button data-act="sol">Show answer</button>`) +
      `<span class="kb">Ctrl + Enter to run</span>`;
  });

  // Redraw the sticky drill bar and the "drills done" score, keeping the load-status text as it is
  function bar(){
    $("n-done").textContent = `${Object.keys(saved.done).length}/${D.length}`;
    const status = $("status").outerHTML;
    $("bar").innerHTML = `<span class="lbl">Drills</span>` + D.map((d, i) =>
      `<a href="#d${i + 1}" class="${saved.done["d" + (i + 1)] ? "done" : ""}" title="${esc(d.title)}">${i + 1}</a>`).join("") + status;
  }
  bar();

  let ready = false, busy = false;
  // Show the checker's verdict: ok (green), no (red) or info (neutral)
  const verdict = (art, cls, text) => { const v = art.querySelector(".verdict"); v.hidden = false; v.className = "verdict " + cls; v.textContent = text; };
  // While code runs (Python and R can take a moment) the buttons are locked so clicks don't queue up
  const lock = on => { busy = on; document.querySelectorAll('.actions [data-act="run"], .actions [data-act="check"]').forEach(b => b.disabled = on); };

  // Handle a button: hint and sol just reveal text; run shows the result; check also marks the drill
  async function act(id, what){
    const art = $(id === "free" ? "scratch" : id), out = $("out-" + id);
    if(what === "hint"){ art.querySelector(".hint").hidden = false; return; }
    if(what === "sol"){ art.querySelector(".solution").hidden = false; return; }
    if(!ready || busy) return;
    lock(true);
    try{
      let r;
      try{ r = await cfg.engine.run($("q-" + id).value); out.innerHTML = table(r, missing); }
      catch(e){ out.innerHTML = `<div class="err">${esc(e.message)}</div>`; if(what === "check") verdict(art, "no", "The code has an error: fix it and check again."); return; }
      if(what !== "check") return;
      const d = D[+id.slice(1) - 1];
      const msg = compare(r, await cfg.engine.run(d.sol), d.ordered);
      if(msg) verdict(art, "no", msg);
      else if(d.desc && !sortedBy(r.values, d.desc)) verdict(art, "info", cfg.orderTip || "The right rows, but not in the order the drill asks for. Check your sort.");
      else {
        verdict(art, "ok", "Spot on. Drill " + id.slice(1) + " done.");
        saved.done[id] = 1; persist(); art.classList.add("done"); bar();
      }
    } finally { lock(false); }
  }
  // One delegated listener for every drill's buttons
  document.addEventListener("click", e => {
    const b = e.target.closest(".actions button"); if(!b) return;
    act(b.closest(".actions").dataset.id, b.dataset.act);
  });
  // In an editor: Ctrl/Cmd+Enter runs, Tab indents (Shift+Tab still moves focus out)
  document.addEventListener("keydown", e => {
    const t = e.target; if(t.tagName !== "TEXTAREA" || !t.id.startsWith("q-")) return;
    if(e.key === "Enter" && (e.ctrlKey || e.metaKey)){ e.preventDefault(); act(t.id.slice(2), "run"); }
    if(e.key === "Tab" && !e.shiftKey){ e.preventDefault(); t.setRangeText(indent, t.selectionStart, t.selectionEnd, "end"); }
  });
  // Save drafts as the learner types
  document.addEventListener("input", e => {
    const t = e.target; if(!t.id || !t.id.startsWith("q-")) return;
    saved.drafts[t.id.slice(2)] = t.value; persist();
  });

  /* boot: load the engine, then hand over to the page and unlock the buttons */
  (async () => {
    const status = $("status");
    try{ await cfg.engine.load(text => { $("status").textContent = text; }); }
    catch(e){
      // fetch() can't read local files, so opening the page straight from disk needs a hint
      const s = $("status"); s.classList.add("err");
      s.textContent = location.protocol === "file:" ? "Can't load the data from a file. Serve the folder (python -m http.server) and reload." : "Couldn't load the session engine. Reload to try again.";
      console.error(e);
      return;
    }
    if(cfg.onReady) await cfg.onReady();
    ready = true;
    $("status").textContent = "Ready";
    document.querySelectorAll(".actions button").forEach(b => b.disabled = false);
  })();
};

/* ---------- hero: the shot map, drawn from the data ----------
   shots: rows of [x, y, xg, isGoal] in match order. Dots appear over ~2.6s (all at once with reduced motion). */
FAL.heroMap = shots => {
  const cv = $("hero"); if(!cv || !cv.getContext) return;
  const ctx = cv.getContext("2d"), reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let W = 0, H = 0, start = null;
  const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();   // read a colour token
  // Match the canvas to its CSS size, sharp on high-DPI screens
  function size(){ const dpr = Math.min(2, devicePixelRatio || 1); W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); }
  // half pitch, goal at the top: StatsBomb y (0–80) runs across, x (60–120) runs up the screen
  // progress 0–1: the share of shots drawn so far
  function draw(progress){
    // fit a 80 × 60 half pitch inside the canvas with a margin, centred
    const m = Math.max(14, W * .05), s = Math.min((W - 2 * m) / 80, (H - 2 * m) / 60), ox = (W - 80 * s) / 2, oy = (H - 60 * s) / 2;
    const P = (x, y) => [ox + y * s, oy + (120 - x) * s];
    ctx.fillStyle = css("--night-2"); ctx.fillRect(0, 0, W, H);
    // pitch markings: half pitch, penalty box, six-yard box, penalty spot, centre circle, the D, the goal
    ctx.strokeStyle = css("--nline"); ctx.lineWidth = 1.4;
    const rect = (x1, y1, x2, y2) => { const [a, b] = P(x1, y1), [c, d] = P(x2, y2); ctx.strokeRect(Math.min(a, c), Math.min(b, d), Math.abs(c - a), Math.abs(d - b)); };
    rect(60, 0, 120, 80); rect(102, 18, 120, 62); rect(114, 30, 120, 50);
    const [px, py] = P(108, 40); ctx.fillStyle = css("--nline"); ctx.beginPath(); ctx.arc(px, py, 2, 0, 7); ctx.fill();
    ctx.beginPath(); const [cx, cy] = P(60, 40); ctx.arc(cx, cy, 10 * s, Math.PI, 2 * Math.PI); ctx.stroke();
    ctx.beginPath(); ctx.arc(px, py, 10 * s, .2 * Math.PI, .8 * Math.PI); ctx.stroke();
    const [g1x, g1y] = P(120, 36), [g2x] = P(120, 44); ctx.strokeStyle = css("--chalk"); ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(g1x, g1y); ctx.lineTo(g2x, g1y); ctx.stroke();
    // shots: goals bright amber, the rest faint green; radius grows with √xG. Shots from inside
    // the team's own half (x < 60) are clamped to halfway so they stay on the drawing.
    const n = Math.floor(shots.length * progress), flood = css("--flood"), grass = css("--grass");
    for(let i = 0; i < n; i++){
      const [x, y, xg, goal] = shots[i]; const [sx, sy] = P(Math.max(60, x), y);
      ctx.globalAlpha = goal ? .95 : .32; ctx.fillStyle = goal ? flood : grass;
      ctx.beginPath(); ctx.arc(sx, sy, 1.2 + Math.sqrt(xg) * 9 * s / 6, 0, 7); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  // animation loop: redraw with a growing share of shots until all are on
  function frame(t){ if(start === null) start = t; const p = Math.min(1, (t - start) / 2600); draw(p); if(p < 1) requestAnimationFrame(frame); }
  size(); new ResizeObserver(() => { size(); draw(1); }).observe(cv);
  if(reduce) draw(1); else requestAnimationFrame(frame);
};

/* ---------- data from CSV, for sessions that don't run SQL ----------
   Fetches the three CSV files once. Resolves to {text: {matches, players, shots}, counts, heroShots}
   so a page can fill the squad sheet and hero straight away, and hand the raw text to its engine. */
FAL.loadCSVs = async (base = "../data/") => {
  const names = ["matches", "players", "shots"], text = {};
  await Promise.all(names.map(async n => {
    const r = await fetch(base + n + ".csv"); if(!r.ok) throw new Error(n + ".csv: HTTP " + r.status);
    text[n] = await r.text();
  }));
  const rows = Object.fromEntries(names.map(n => [n, FAL.parseCSV(text[n])]));
  const open = rows.shots.filter(s => +s.period < 5);
  return {
    text,
    counts: {matches: rows.matches.length, players: rows.players.length, shots: rows.shots.length, shotsNoShootout: open.length},
    heroShots: open.map(s => [+s.x, +s.y, +s.xg, s.outcome === "Goal"])
  };
};
})();
