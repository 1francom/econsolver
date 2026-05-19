import { runFactorsValidation } from "./factorsValidation.js";
const ok = await runFactorsValidation();
process.exit(ok ? 0 : 1);
