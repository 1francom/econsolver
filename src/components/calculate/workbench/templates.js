// Card-seed library migrated from the old Math Pad. Each entry is a partial
// equation spec; EquationsPanel merges it through newEquation().
export const TEMPLATES = [
  { group: "Production", label: "Cobb-Douglas Y", seed: {
      label: "Y", expr: "A*K^alpha*L^(1-alpha)", axis: "K",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } } },
  { group: "Production", label: "Solow output/worker", seed: {
      label: "y", expr: "A*k^alpha", axis: "k",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } } },
  { group: "Profit", label: "Profit π(q)", seed: {
      label: "pi", expr: "(a - b*q)*q - F - c*q", axis: "q",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: true }, sense: "max" } },
  { group: "Utility", label: "Cobb-Douglas U", seed: {
      label: "U", expr: "x^a*y^(1-a)", axis: "x",
      ops: { plot: true, deriv: true, integral: false, solveZero: false, optimize: false } } },
  { group: "Cost", label: "Marginal damage ∫MD", seed: {
      label: "MD", expr: "d*E", axis: "E",
      ops: { plot: true, deriv: false, integral: true, solveZero: false, optimize: false } } },
  { group: "Constraint", label: "Budget p·x+q·y=m", seed: {
      kind: "constraint", label: "budget",
      relation: { lhs: "p*x + q*y", op: "=", rhs: "m" },
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: false } } },
  { group: "Constraint", label: "Emissions cap E≤cap", seed: {
      kind: "constraint", label: "cap",
      relation: { lhs: "E", op: "=", rhs: "cap" },
      ops: { plot: false, deriv: false, integral: false, solveZero: false, optimize: false } } },
];
