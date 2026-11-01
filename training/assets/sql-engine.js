/* SQL engine for the training-ground sessions: SQLite in the browser via sql.js.
   Needs sql-wasm.js (cdnjs) and session.js loaded first. Usage:
     const engine = FAL.sqlEngine();
     FAL.session({engine, onReady: engine.ready, …}); */
FAL.sqlEngine = (dbUrl = "../data/wc2022.sqlite") => {
  let db = null;   // the sql.js database, set once load() has finished

  // Run SQL and return the last statement's result (so "SELECT 1; SELECT 2;" shows the second).
  // Statements are stepped one by one rather than with db.exec, which drops a query's column
  // names when it returns no rows; a learner's empty result should read "0 rows", not "no table".
  const exec = sql => {
    let last = {columns: [], values: []};
    for(const stmt of db.iterateStatements(sql)){
      const columns = stmt.getColumnNames(), values = [];
      while(stmt.step()) values.push(stmt.get());
      if(columns.length) last = {columns, values};
    }
    return last;
  };

  return {
    // Load the SQLite engine (WebAssembly, from cdnjs) and the database file in parallel
    async load(status){
      status("Loading the database…");
      const [SQL, buf] = await Promise.all([
        initSqlJs({locateFile: f => `https://cdnjs.cloudflare.com/ajax/libs/sql.js/1.10.3/${f}`}),
        fetch(dbUrl).then(r => { if(!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); })
      ]);
      db = new SQL.Database(new Uint8Array(buf));
    },
    // sql.js is synchronous; wrapping it in an async function matches the shared engine contract
    async run(sql){ return exec(sql); },
    // Once loaded: live row counts for the squad sheet and scoreboard, and the hero map drawn by a query
    async ready(){
      const one = sql => exec(sql).values[0][0];
      FAL.setRows({matches: one("SELECT COUNT(*) FROM matches"), players: one("SELECT COUNT(*) FROM players"),
                   shots: one("SELECT COUNT(*) FROM shots"), shotsNoShootout: one("SELECT COUNT(*) FROM shots WHERE period < 5")});
      FAL.heroMap(exec("SELECT x, y, xg, outcome = 'Goal' FROM shots WHERE period < 5 ORDER BY match_id, period, minute, second").values);
    }
  };
};
