import { runPipeline } from "../runner.js";

let pass = 0;
let fail = 0;
const check = (n, c) => c ? (pass++, console.log("  [pass]", n)) : (fail++, console.log("  [FAIL]", n));

const base = [
  { __ri: 0, region: "north", n: 10, label: "ab12" },
  { __ri: 1, region: "south", n: 20, label: "cd34" },
  { __ri: 2, region: "north", n: 30, label: "ef56" },
];
const H = ["region", "n", "label"];
const run = step => runPipeline(base, H, [step], { datasets: {} });

// add_column
let o = run({ type: "add_column", nn: "flag", fill: "1", dtype: "number" });
check("add_column adds numeric col", o.headers.includes("flag") && o.rows.every(r => r.flag === 1));

// add_row
o = run({ type: "add_row", count: 2, values: { region: "west" }, _seq: 3 });
check("add_row appends 2 rows", o.rows.length === 5);
check("add_row stable __ri", o.rows[3].__ri === 1e9 + 3000 && o.rows[4].__ri === 1e9 + 3001);
check("add_row fills provided + nulls", o.rows[3].region === "west" && o.rows[3].n === null);
check("add_row preserves headers", o.headers.join("|") === H.join("|"));

// set_where (contains)
o = run({ type: "set_where", col: "n", where: { col: "region", op: "contains", value: "nor" }, action: "set", value: "99", dtype: "number" });
check("set_where contains edits only matches", o.rows[0].n === 99 && o.rows[1].n === 20 && o.rows[2].n === 99);

// set_where (between on numeric)
o = run({ type: "set_where", col: "region", where: { col: "n", op: "between", value: [15, 25] }, action: "clear" });
check("set_where between+clear", o.rows[1].region === null && o.rows[0].region === "north");

// replace (regex)
o = run({ type: "replace", col: "label", match: { mode: "regex", find: "[0-9]+" }, replaceWith: "#" });
check("replace regex", o.rows[0].label === "ab#" && o.rows[1].label === "cd#");

// replace (contains, new column)
o = run({ type: "replace", col: "region", match: { mode: "contains", find: "th" }, replaceWith: "TH", nn: "region2" });
check("replace contains new col", o.headers.includes("region2") && o.rows[0].region2 === "norTH" && o.rows[0].region === "north");

// str_splice insert
o = run({ type: "str_splice", col: "label", position: 3, mode: "insert", text: "-" });
check("str_splice insert at pos 3", o.rows[0].label === "ab-12");

// str_splice delete from end
o = run({ type: "str_splice", col: "label", position: -1, mode: "delete", count: 1 });
check("str_splice delete last char", o.rows[0].label === "ab1");

// str_splice overwrite + numeric re-coercion
o = run({ type: "str_splice", col: "n", position: 1, mode: "overwrite", text: "9", count: 1 });
check("str_splice numeric re-coerce", o.rows[0].n === 90 && typeof o.rows[0].n === "number");

console.log(`\ngridSteps: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
