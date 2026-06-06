import assert from "node:assert/strict";
import { classifyConflict } from "../conflict.js";

assert.equal(classifyConflict({ lastSyncedVersion: 1, dirty: false }, 1), "none");
assert.equal(classifyConflict({ lastSyncedVersion: 1, dirty: true }, 1), "local-ahead");
assert.equal(classifyConflict({ lastSyncedVersion: 1, dirty: false }, 2), "server-ahead");
assert.equal(classifyConflict({ lastSyncedVersion: 1, dirty: true }, 2), "diverged");
assert.equal(classifyConflict({ lastSyncedVersion: 3, dirty: false }, 2), "none");
assert.equal(classifyConflict({ lastSyncedVersion: 3, dirty: true }, 2), "local-ahead");
assert.equal(classifyConflict({ dirty: false }, null), "none");

console.log("conflict validation passed");
