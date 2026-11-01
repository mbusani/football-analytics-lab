/* R engine for the training-ground sessions: R in the browser via webR, with dplyr.
   Needs session.js loaded first; webR itself is imported from webr.r-wasm.org on load. Usage:
     FAL.session({engine: FAL.rEngine(), …});

   Learner code runs in a fresh environment each time. The three tables (matches, players, shots)
   live in the global environment as data frames, so assigning to them inside a drill only changes
   the drill's own copy. The result is `answer` if the code sets it, otherwise the value of the last line. */
FAL.rEngine = () => {
  const WEBR = "https://webr.r-wasm.org/v0.4.4/webr.mjs";
  let webR = null;   // the webR instance, set once load() has finished

  // R run once at start-up: load dplyr, read the CSVs and define the helpers the engine calls
  const SETUP = `
suppressPackageStartupMessages(library(dplyr))
options(dplyr.summarise.inform = FALSE, width = 100)

# One data frame per table; empty fields become NA
for (.n in c("matches", "players", "shots")) {
  assign(.n, read.csv(file.path("/data", paste0(.n, ".csv")), na.strings = "", encoding = "UTF-8"), envir = globalenv())
}
rm(.n)

# Turn whatever the learner produced into a named list of plain columns for the checker and the results table
.fal_table <- function(x) {
  if (is.null(x)) return(NULL)
  if (is.table(x)) x <- as.data.frame(x, stringsAsFactors = FALSE)
  if (!is.data.frame(x)) x <- data.frame(value = x, stringsAsFactors = FALSE)  # vectors and single values become one column
  x <- as.data.frame(x)                                                        # tibbles, grouped or not, become plain data frames
  lapply(x, function(col) if (is.factor(col) || inherits(col, "Date")) as.character(col) else col)
}

# Run learner code; return printed output and the result table, or list(error = message).
# Errors are caught here because webR replaces dplyr's detailed messages (which column is missing,
# and so on) with a generic one; conditionMessage() keeps the wording learners will see in RStudio.
.fal_run <- function(code) {
  env <- new.env(parent = globalenv())
  value <- NULL
  tryCatch({
    output <- utils::capture.output({
      for (e in parse(text = code, keep.source = FALSE)) value <- eval(e, env)
    })
    result <- if (exists("answer", envir = env, inherits = FALSE)) get("answer", envir = env) else value
    list(output = paste(output, collapse = "\\n"), table = .fal_table(result))
  }, error = function(e) {
    call <- conditionCall(e)
    where <- if (is.null(call) || inherits(e, "rlang_error")) "" else paste0(" in ", deparse(call)[1])
    list(error = paste0("Error", where, ": ", paste(conditionMessage(e), collapse = "\\n")))
  })
}
`;

  return {
    // Fetch the CSVs (and draw the hero straight away), then start R and install dplyr
    async load(status){
      status("Loading the data…");
      const data = await FAL.loadCSVs();
      FAL.setRows(data.counts);
      FAL.heroMap(data.heroShots);
      status("Starting R (the first visit downloads about 30 MB)…");
      const { WebR } = await import(WEBR);
      webR = new WebR();
      await webR.init();
      status("Installing dplyr…");
      await webR.installPackages(["dplyr"], {quiet: true});
      await webR.FS.mkdir("/data");
      const enc = new TextEncoder();
      for(const [name, text] of Object.entries(data.text)) await webR.FS.writeFile(`/data/${name}.csv`, enc.encode(text));
      await webR.evalRVoid(SETUP);
    },
    // Convert R's {output, table} list into {columns, values, output} rows
    async run(code){
      const shelter = await new webR.Shelter();   // frees every R object made during this run
      try{
        const res = await shelter.evalR(".fal_run(code)", {env: {code}});
        const js = await res.toJs();
        if(js.names[0] === "error") throw new Error(js.values[0].values[0]);
        const [output, table] = js.values;
        const out = output.values.join("\n");
        if(table.type === "null") return {columns: [], values: [], output: out};
        const cols = table.values.map(c => c.values);
        const n = cols.length ? cols[0].length : 0;
        return {output: out, columns: table.names, values: Array.from({length: n}, (_, i) => cols.map(c => c[i] ?? null))};
      }finally{ shelter.purge(); }
    }
  };
};
