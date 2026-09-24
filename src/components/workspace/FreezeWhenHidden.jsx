// ─── ECON STUDIO · components/workspace/FreezeWhenHidden.jsx ─────────────────
// App keeps every module mounted and hides the inactive ones with
// display:none, so a module keeps its state across tab switches. The cost was
// that every App render — every tab click, sidebar toggle, dataset selection —
// re-rendered ALL modules, visible or not, because each receives fresh inline
// callbacks. This gate skips the re-render while the pane is hidden: the
// module stays mounted, its own state updates and context changes still
// render it, and the first render after it becomes visible again uses the
// latest props.

import { memo } from "react";

const FreezeWhenHidden = memo(
  function FreezeWhenHidden({ children }) { return children; },
  // true = "props equal" = skip. Only while hidden; a visible pane always renders.
  (_prev, next) => next.frozen,
);

export default FreezeWhenHidden;
