/* Python engine for the training-ground sessions: CPython in the browser via Pyodide, with pandas.
   Needs pyodide.js (jsDelivr) and session.js loaded first. Usage:
     FAL.session({engine: FAL.pythonEngine(), …});

   Learner code runs in a fresh namespace each time with pd, np and copies of the three tables
   (matches, players, shots) as DataFrames, so a drill can't break the data for the next one.
   The result is `answer` if the code sets it, otherwise the value of the last line, like a notebook cell. */
FAL.pythonEngine = () => {
  const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
  let py = null;   // the Pyodide instance, set once load() has finished

  // Python run once at start-up: read the CSVs and define the helpers the engine calls
  const SETUP = `
import ast, contextlib, io, json, math, traceback, warnings
# pandas 2.2 warns on import that Pyarrow will be required in pandas 3; it isn't something learners can act on
warnings.filterwarnings("ignore", message=r"\\s*Pyarrow")   # the message starts with a newline
import numpy as np
import pandas as pd

# keep_default_na=False stops strings such as "NA" turning into missing values; only empty fields are missing
_DATA = {n: pd.read_csv(f"/data/{n}.csv", keep_default_na=False, na_values=[""]) for n in ("matches", "players", "shots")}

def _fal_cell(v):
    """One value, made JSON-safe: numpy scalars to Python, NaN/NA to None, anything odd to text."""
    if v is None or v is pd.NA or v is pd.NaT:
        return None
    if isinstance(v, np.generic):
        v = v.item()
    if isinstance(v, float) and math.isnan(v):
        return None
    if isinstance(v, (bool, int, float, str)):
        return v
    return str(v)

def _fal_table(x):
    """Turn whatever the learner produced into {columns, values} for the checker and the results table."""
    if x is None:
        return {"columns": [], "values": []}
    if isinstance(x, pd.Series):
        x = x.to_frame(name=x.name if x.name is not None else "value")
    if isinstance(x, pd.DataFrame):
        # a grouped result keeps its keys in a named index: bring them back as columns.
        # A plain filtered frame has an unnamed index of row numbers, which is dropped.
        if isinstance(x.index, pd.MultiIndex) or x.index.name is not None:
            x = x.reset_index()
        return {"columns": [str(c) for c in x.columns],
                "values": [[_fal_cell(v) for v in row] for row in x.itertuples(index=False, name=None)]}
    if isinstance(x, (list, tuple, np.ndarray)):
        return {"columns": ["value"], "values": [[_fal_cell(v)] for v in x]}
    return {"columns": ["value"], "values": [[_fal_cell(x)]]}

def _fal_error(e):
    """A short message pointing at the learner's own line, without Pyodide's internal frames."""
    if isinstance(e, SyntaxError):
        return f"SyntaxError on line {e.lineno}: {e.msg}"
    line = next((f.lineno for f in reversed(traceback.extract_tb(e.__traceback__)) if f.filename == "<drill>"), None)
    return f"{type(e).__name__}{f' on line {line}' if line else ''}: {e}"

def _fal_run(code):
    """Run learner code; return JSON with printed output and the result table, or an error."""
    ns = {"pd": pd, "np": np, **{name: frame.copy() for name, frame in _DATA.items()}}
    out = io.StringIO()
    try:
        tree = ast.parse(code, "<drill>", "exec")
        last = None
        if tree.body and isinstance(tree.body[-1], ast.Expr):   # like a notebook: a bare last line is the result
            last = ast.Expression(tree.body.pop().value)
        with contextlib.redirect_stdout(out):
            exec(compile(tree, "<drill>", "exec"), ns)
            value = eval(compile(last, "<drill>", "eval"), ns) if last else None
    except Exception as e:
        return json.dumps({"error": _fal_error(e), "output": out.getvalue()})
    result = ns["answer"] if "answer" in ns else value
    return json.dumps({"output": out.getvalue(), **_fal_table(result)})
`;

  return {
    // Fetch the CSVs (and draw the hero straight away), then start Python and load pandas
    async load(status){
      status("Loading the data…");
      const data = await FAL.loadCSVs();
      FAL.setRows(data.counts);
      FAL.heroMap(data.heroShots);
      status("Starting Python (the first visit downloads about 20 MB)…");
      py = await loadPyodide({indexURL: PYODIDE});
      status("Loading pandas…");
      await py.loadPackage("pandas");
      py.FS.mkdir("/data");
      for(const [name, text] of Object.entries(data.text)) py.FS.writeFile(`/data/${name}.csv`, text);
      await py.runPythonAsync(SETUP);
    },
    // Errors come back inside the JSON so the message can name the learner's line
    async run(code){
      const fn = py.globals.get("_fal_run");
      try{
        const res = JSON.parse(fn(code));
        if(res.error) throw new Error((res.output ? res.output + "\n" : "") + res.error);
        return res;
      } finally { fn.destroy(); }
    }
  };
};
