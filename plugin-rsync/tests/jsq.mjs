// Evaluate a JS expression against JSON on stdin (bound to `r`); print the result as JSON.
let d = "";
process.stdin.on("data", (c) => (d += c)).on("end", () => {
  const r = JSON.parse(d);
  console.log(JSON.stringify(new Function("r", "return (" + process.argv[2] + ");")(r)));
});
