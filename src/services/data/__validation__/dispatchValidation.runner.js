// Node entry point for the dispatch validation harness.
// Run: node src/services/data/__validation__/dispatchValidation.runner.js
import { runDispatchValidation } from "./dispatchValidation.js";
const ok = await runDispatchValidation();
process.exit(ok ? 0 : 1);
