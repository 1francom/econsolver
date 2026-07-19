/**
 * Connected components of a bipartite link graph (igraph::components equivalent).
 *
 * Motivating case: AKM two-way worker-firm models. A firm effect psi_j is only
 * identified RELATIVE to other firms, and only through chains of workers who
 * moved between them. Two firms in different components have no such chain, so
 * their effects sit on separate, unrelated scales — comparing them is
 * meaningless, and the usual practice is to keep the largest connected set.
 *
 * Why bipartite rather than a firm-firm mover graph: PS4 builds firm-firm edges
 * from consecutive spells of the same worker, then runs igraph::components. That
 * gives the same PARTITION of firms as connecting each worker to each firm they
 * appear with, because two firms are linked by a mover exactly when they share a
 * worker in the bipartite graph. Doing it bipartite is simpler (no ordering, no
 * lag), needs no time column, and also yields the workers' component, which the
 * firm-firm graph does not.
 *
 * Union-find with path compression + union by size: near-linear, no recursion,
 * so it will not blow the stack on a large panel.
 */

/** Disjoint-set over integer ids. */
function makeDSU(n) {
  const parent = new Int32Array(n);
  const size = new Int32Array(n).fill(1);
  for (let i = 0; i < n; i++) parent[i] = i;

  function find(x) {
    let root = x;
    while (parent[root] !== root) root = parent[root];
    while (parent[x] !== root) { const next = parent[x]; parent[x] = root; x = next; }
    return root;
  }
  function union(a, b) {
    let ra = find(a), rb = find(b);
    if (ra === rb) return;
    if (size[ra] < size[rb]) { const t = ra; ra = rb; rb = t; }
    parent[rb] = ra;
    size[ra] += size[rb];
  }
  return { find, union };
}

/**
 * @param {object[]} rows
 * @param {string} colA  first vertex column (e.g. person id)
 * @param {string} colB  second vertex column (e.g. firm id)
 * @returns {{
 *   componentOf: number[],          // component id per row, 1 = largest
 *   sizes: number[],                // rows per component, index 0 = component 1
 *   nComponents: number,
 *   aLevels: number, bLevels: number,
 *   largest: { rows:number, a:number, b:number },
 *   skipped: number                 // rows with a null on either column
 * }}
 */
export function connectedComponents(rows, colA, colB) {
  if (!Array.isArray(rows) || !rows.length) throw new Error("connectedComponents: no rows.");
  if (!colA || !colB) throw new Error("connectedComponents: two link columns are required.");
  if (colA === colB) throw new Error("connectedComponents: the two link columns must differ.");

  // Vertices: side A and side B live in ONE id space, offset so they cannot
  // collide when a person id and a firm id happen to be the same number.
  const aId = new Map(), bId = new Map();
  for (const r of rows) {
    const a = r[colA], b = r[colB];
    if (a == null || b == null) continue;
    const ka = String(a), kb = String(b);
    if (!aId.has(ka)) aId.set(ka, aId.size);
    if (!bId.has(kb)) bId.set(kb, bId.size);
  }
  const nA = aId.size, nB = bId.size;
  if (!nA || !nB) throw new Error("connectedComponents: no complete links found.");

  const dsu = makeDSU(nA + nB);
  let skipped = 0;
  for (const r of rows) {
    const a = r[colA], b = r[colB];
    if (a == null || b == null) { skipped++; continue; }
    dsu.union(aId.get(String(a)), nA + bId.get(String(b)));
  }

  // Component sizes, counted in ROWS so the "largest" matches what a filter keeps.
  const rowRoot = rows.map(r => {
    const a = r[colA], b = r[colB];
    if (a == null || b == null) return -1;
    return dsu.find(aId.get(String(a)));
  });
  const rowsPerRoot = new Map();
  for (const root of rowRoot) if (root >= 0) rowsPerRoot.set(root, (rowsPerRoot.get(root) ?? 0) + 1);

  // Rank components by row count, descending, so id 1 is always the largest.
  // Ties break on the root index, which keeps numbering deterministic across runs.
  const ranked = [...rowsPerRoot.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0]);
  const idOf = new Map(ranked.map(([root], i) => [root, i + 1]));

  const componentOf = rowRoot.map(root => (root >= 0 ? idOf.get(root) : null));

  // Distinct vertices inside the largest component.
  const topRoot = ranked.length ? ranked[0][0] : -1;
  const aSeen = new Set(), bSeen = new Set();
  for (const r of rows) {
    const a = r[colA], b = r[colB];
    if (a == null || b == null) continue;
    if (dsu.find(aId.get(String(a))) === topRoot) { aSeen.add(String(a)); bSeen.add(String(b)); }
  }

  return {
    componentOf,
    sizes: ranked.map(([, n]) => n),
    nComponents: ranked.length,
    aLevels: nA,
    bLevels: nB,
    largest: { rows: ranked.length ? ranked[0][1] : 0, a: aSeen.size, b: bSeen.size },
    skipped,
  };
}
