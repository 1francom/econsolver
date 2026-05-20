import { runRobustSEValidation } from "./robustSEValidation.js";
const ok = await runRobustSEValidation();
process.exit(ok ? 0 : 1);
