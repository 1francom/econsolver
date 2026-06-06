import {
  randomSaltB64,
  deriveKey,
  encryptJSON,
  decryptJSON,
  encryptBytes,
  decryptBytes,
  makeVerifier,
  checkVerifier,
  exportRecoveryKey,
  importRecoveryKey,
  sha256B64,
} from "./crypto.js";
import { getCurrentUserId, getSyncSupabase } from "./supabaseClient.js";
import { classifyConflict } from "./conflict.js";
import { assertSafeExpr } from "../../pipeline/exprGuard.js";
import {
  listProjects,
  saveProject,
  loadProjectPipelines,
  savePipeline,
  loadRawData,
  saveRawData,
  loadWorkbenchRecord,
  saveWorkbenchRecord,
  loadCoachChats,
  saveCoachChats,
  loadModelBuffer,
  saveModelBuffer,
  loadSpatialMaps,
  saveSpatialMaps,
  loadDatasetRegistry,
  saveDatasetRegistry,
  getSyncMeta,
  setSyncMeta,
} from "../Persistence/indexedDB.js";

const BUCKET = "synced-blobs";
const MANIFEST_SCHEMA = 1;
const PUSH_DEBOUNCE_MS = 700;

let sessionKey = null;
let sessionSalt = null;
let sessionVerifier = null;
const pushTimers = new Map();

function encodeJSON(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null));
}

function decodeJSON(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function storageNameForArtifact(key) {
  return encodeURIComponent(key) + ".json.enc";
}

function pathForArtifact(userId, pid, key) {
  return `${userId}/${pid}/${storageNameForArtifact(key)}`;
}

function verifierToText(verifier) {
  return JSON.stringify(verifier);
}

function verifierFromText(verifier) {
  return typeof verifier === "string" ? JSON.parse(verifier) : verifier;
}

function manifestToText(manifest) {
  return JSON.stringify(manifest);
}

function manifestFromText(manifest) {
  return typeof manifest === "string" ? JSON.parse(manifest) : manifest;
}

function requireSessionKey(explicitKey) {
  const key = explicitKey ?? sessionKey;
  if (!key) throw new Error("Cloud sync is locked for this browser session.");
  return key;
}

async function getLocalProject(pid) {
  const projects = await listProjects();
  return projects.find(project => project.pid === pid) ?? null;
}

async function getCloudRow(pid) {
  const supabase = getSyncSupabase();
  const { data, error } = await supabase
    .from("synced_projects")
    .select("*")
    .eq("pid", pid)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
}

async function getAnyCloudRow() {
  const supabase = getSyncSupabase();
  const { data, error } = await supabase
    .from("synced_projects")
    .select("pid,salt,verifier,version,updated_at")
    .order("updated_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

async function readProjectBundle(pid) {
  const project = await getLocalProject(pid);
  if (!project) throw new Error("Local project not found.");

  const datasetRegistry = await loadDatasetRegistry(pid);
  const datasetIds = new Set([pid, ...datasetRegistry.map(d => d?.id).filter(Boolean)]);
  const rawData = {};
  for (const datasetId of datasetIds) {
    const data = await loadRawData(datasetId);
    if (data) rawData[datasetId] = data;
  }

  return {
    project,
    pipelines: await loadProjectPipelines(pid),
    datasetRegistry,
    rawData,
    workbench: await loadWorkbenchRecord(pid),
    coachChats: await loadCoachChats(pid),
    modelBuffer: await loadModelBuffer(pid),
    spatialMaps: await loadSpatialMaps(pid),
  };
}

function artifactListFromBundle(bundle) {
  const artifacts = [
    ["project_meta", bundle.project],
    ["pipelines", bundle.pipelines],
    ["dataset_registry", bundle.datasetRegistry],
    ["workbench", bundle.workbench],
    ["coach_chats", bundle.coachChats],
    ["model_buffer", bundle.modelBuffer],
    ["spatial_maps", bundle.spatialMaps],
  ];

  for (const [datasetId, raw] of Object.entries(bundle.rawData ?? {})) {
    artifacts.push([`raw_data:${datasetId}`, raw]);
  }

  return artifacts
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => ({ key, value, bytes: encodeJSON(value) }));
}

async function buildEncryptedManifest({ pid, userId, key, baseManifest = null, force = false }) {
  const bundle = await readProjectBundle(pid);
  const previous = new Map((baseManifest?.artifacts ?? []).map(a => [a.key, a]));
  const manifest = {
    schema: MANIFEST_SCHEMA,
    pid,
    updatedAt: Date.now(),
    artifacts: [],
  };
  const uploads = [];

  for (const artifact of artifactListFromBundle(bundle)) {
    const hash = await sha256B64(artifact.bytes);
    const previousArtifact = previous.get(artifact.key);
    const storageKey = previousArtifact?.storageKey ?? pathForArtifact(userId, pid, artifact.key);
    const nextEntry = {
      key: artifact.key,
      storageKey,
      hash,
      bytes: artifact.bytes.byteLength,
      iv: previousArtifact?.iv ?? null,
    };

    if (force || previousArtifact?.hash !== hash || !previousArtifact?.iv) {
      const encrypted = await encryptBytes(key, artifact.bytes);
      nextEntry.iv = encrypted.iv;
      uploads.push({ storageKey, ct: encrypted.ct });
    }

    manifest.artifacts.push(nextEntry);
  }

  return { manifest, uploads };
}

async function uploadArtifacts(uploads) {
  const supabase = getSyncSupabase();
  for (const upload of uploads) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(upload.storageKey, upload.ct, {
        upsert: true,
        contentType: "text/plain;charset=utf-8",
      });
    if (error) throw error;
  }
}

async function downloadArtifact(storageKey) {
  const supabase = getSyncSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).download(storageKey);
  if (error) throw error;
  if (typeof data === "string") return data;
  if (data?.text) return data.text();
  return new TextDecoder().decode(new Uint8Array(await data.arrayBuffer()));
}

async function decryptManifest(key, row) {
  const encrypted = manifestFromText(row.manifest);
  return decryptJSON(key, encrypted.ct, encrypted.iv);
}

function exprFieldsOf(step) {
  const out = [];
  if (typeof step?.expr === "string") out.push(step.expr);
  if (typeof step?.cond === "string") out.push(step.cond);
  if (typeof step?.js === "string") out.push(step.js);
  if (Array.isArray(step?.cases)) {
    step.cases.forEach(c => { if (typeof c?.cond === "string") out.push(c.cond); });
  }
  if (Array.isArray(step?.rules)) {
    step.rules.forEach(r => { if (typeof r?.expr === "string") out.push(r.expr); });
  }
  return out;
}

function assertSafeSteps(steps) {
  if (!Array.isArray(steps)) return;
  for (const step of steps) {
    for (const expr of exprFieldsOf(step)) assertSafeExpr(expr);
  }
}

export function assertSafePulledPipelines(pipelines) {
  if (!pipelines) return;
  const datasetPipelines = pipelines.datasetPipelines ?? {};
  for (const record of Object.values(datasetPipelines)) {
    assertSafeSteps(record?.steps);
    assertSafeSteps(record?.pipeline);
  }
  assertSafeSteps(pipelines.steps);
  assertSafeSteps(pipelines.pipeline);
}

async function decryptBundleFromManifest(key, manifest) {
  const bundle = { rawData: {} };
  for (const artifact of manifest.artifacts ?? []) {
    const ct = await downloadArtifact(artifact.storageKey);
    const bytes = await decryptBytes(key, ct, artifact.iv);
    const value = decodeJSON(bytes);

    if (artifact.key.startsWith("raw_data:")) {
      bundle.rawData[artifact.key.slice("raw_data:".length)] = value;
    } else {
      bundle[{
        project_meta: "project",
        pipelines: "pipelines",
        dataset_registry: "datasetRegistry",
        workbench: "workbench",
        coach_chats: "coachChats",
        model_buffer: "modelBuffer",
        spatial_maps: "spatialMaps",
      }[artifact.key] ?? artifact.key] = value;
    }
  }
  assertSafePulledPipelines(bundle.pipelines);
  return bundle;
}

async function writeProjectBundle(targetPid, bundle, version) {
  const project = {
    ...(bundle.project ?? {}),
    pid: targetPid,
  };
  await saveProject(targetPid, project);

  if (Array.isArray(bundle.datasetRegistry)) {
    await saveDatasetRegistry(targetPid, bundle.datasetRegistry);
  }

  for (const [datasetId, raw] of Object.entries(bundle.rawData ?? {})) {
    await saveRawData(datasetId, raw);
  }

  const pipelineRecord = bundle.pipelines;
  const datasetPipelines = pipelineRecord?.datasetPipelines ?? {};
  for (const [datasetId, record] of Object.entries(datasetPipelines)) {
    await savePipeline(targetPid, datasetId, {
      ...record,
      filename: pipelineRecord?.filename,
      rowCount: pipelineRecord?.rowCount,
      colCount: pipelineRecord?.colCount,
      pipelineLength: pipelineRecord?.pipelineLength,
    });
  }

  if (bundle.workbench) await saveWorkbenchRecord(targetPid, bundle.workbench.sessions ?? []);
  if (bundle.coachChats) await saveCoachChats(targetPid, bundle.coachChats.conversations ?? []);
  if (bundle.modelBuffer) await saveModelBuffer(targetPid, bundle.modelBuffer.models ?? []);
  if (bundle.spatialMaps) await saveSpatialMaps(targetPid, bundle.spatialMaps.maps ?? null);

  await setSyncMeta(targetPid, {
    published: true,
    lastSyncedVersion: version,
    dirty: false,
  });
}

async function forcePushProject(pid, { version = null } = {}) {
  const key = requireSessionKey();
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in before cloud sync.");

  const row = await getCloudRow(pid);
  if (!row) throw new Error("Cloud project not found.");
  const baseManifest = await decryptManifest(key, row);
  const nextVersion = version ?? Number(row.version ?? 0) + 1;
  const { manifest, uploads } = await buildEncryptedManifest({
    pid,
    userId,
    key,
    baseManifest,
  });
  await uploadArtifacts(uploads);
  const encryptedManifest = await encryptJSON(key, manifest);

  const supabase = getSyncSupabase();
  const { error } = await supabase
    .from("synced_projects")
    .update({
      manifest: manifestToText(encryptedManifest),
      version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq("pid", pid);
  if (error) throw error;
  await setSyncMeta(pid, {
    published: true,
    lastSyncedVersion: nextVersion,
    dirty: false,
  });
  return { version: nextVersion, uploaded: uploads.length };
}

export async function enableCloud(pid, passphrase) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in before publishing to cloud.");

  const existingCloud = await getAnyCloudRow();
  const salt = existingCloud?.salt ?? randomSaltB64();
  const key = await deriveKey(passphrase, salt);
  const verifier = await makeVerifier(key);
  const { manifest, uploads } = await buildEncryptedManifest({
    pid,
    userId,
    key,
    force: true,
  });
  await uploadArtifacts(uploads);
  const encryptedManifest = await encryptJSON(key, manifest);

  const projectName = (await listProjects()).find(p => p.pid === pid)?.name ?? null;

  const supabase = getSyncSupabase();
  const { error } = await supabase.from("synced_projects").upsert({
    user_id: userId,
    pid,
    name: projectName,
    salt,
    verifier: verifierToText(verifier),
    manifest: manifestToText(encryptedManifest),
    version: 1,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id,pid" });
  if (error) throw error;

  sessionKey = key;
  sessionSalt = salt;
  sessionVerifier = verifier;
  await setSyncMeta(pid, { published: true, lastSyncedVersion: 1, dirty: false });
  return { recoveryKey: await exportRecoveryKey(key), version: 1 };
}

export function pushProject(pid, options = {}) {
  const immediate = Boolean(options.immediate);
  if (immediate) return forcePushProject(pid);

  const pending = pushTimers.get(pid);
  if (pending) clearTimeout(pending.timer);

  let resolve;
  let reject;
  const promise = pending?.promise ?? new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  resolve = pending?.resolve ?? resolve;
  reject = pending?.reject ?? reject;

  const timer = setTimeout(() => {
    pushTimers.delete(pid);
    forcePushProject(pid).then(resolve, reject);
  }, PUSH_DEBOUNCE_MS);

  pushTimers.set(pid, { timer, resolve, reject, promise });
  return promise;
}

export function flushProjectPush(pid) {
  const pending = pushTimers.get(pid);
  if (!pending) return forcePushProject(pid);
  clearTimeout(pending.timer);
  pushTimers.delete(pid);
  forcePushProject(pid).then(pending.resolve, pending.reject);
  return pending.promise;
}

export async function pullProject(pid, key = null, options = {}) {
  const activeKey = requireSessionKey(key);
  const row = await getCloudRow(pid);
  if (!row) throw new Error("Cloud project not found.");
  const manifest = await decryptManifest(activeKey, row);
  const bundle = await decryptBundleFromManifest(activeKey, manifest);
  const targetPid = options.targetPid ?? pid;
  await writeProjectBundle(targetPid, bundle, Number(row.version ?? 0));
  return { pid: targetPid, version: Number(row.version ?? 0) };
}

export async function listCloudProjects() {
  const supabase = getSyncSupabase();
  const { data, error } = await supabase
    .from("synced_projects")
    .select("pid,name,salt,verifier,version,updated_at")
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function detectConflict(pid) {
  const [localMeta, row] = await Promise.all([getSyncMeta(pid), getCloudRow(pid)]);
  return classifyConflict(localMeta, row?.version ?? null);
}

export async function resolveConflict(pid, choice) {
  if (choice === "keep-local") return forcePushProject(pid);
  if (choice === "keep-cloud") return pullProject(pid);
  if (choice === "fork") {
    const targetPid = `${pid}-cloud-${Date.now()}`;
    await pullProject(pid, null, { targetPid });
    return { pid: targetPid };
  }
  throw new Error("Unknown conflict resolution choice.");
}

export async function unpublish(pid) {
  const userId = await getCurrentUserId();
  if (!userId) throw new Error("Sign in before cloud sync.");
  const prefix = `${userId}/${pid}`;
  const supabase = getSyncSupabase();
  const listed = await supabase.storage.from(BUCKET).list(prefix);
  if (listed.error) throw listed.error;
  const objectNames = (listed.data ?? []).map(obj => `${prefix}/${obj.name}`);
  if (objectNames.length) {
    const removed = await supabase.storage.from(BUCKET).remove(objectNames);
    if (removed.error) throw removed.error;
  }
  const deleted = await supabase.from("synced_projects").delete().eq("pid", pid);
  if (deleted.error) throw deleted.error;
  await setSyncMeta(pid, { published: false, lastSyncedVersion: 0, dirty: false });
}

/**
 * Update the human-readable name for a cloud project (owner only).
 * Also saves the name to local IndexedDB so the two stay in sync.
 */
export async function renameCloudProject(pid, name) {
  const supabase = getSyncSupabase();
  const { error } = await supabase
    .from("synced_projects")
    .update({ name: name || null })
    .eq("pid", pid);
  if (error) throw error;
  // Keep local copy in sync
  await saveProject(pid, { name });
}

export async function lockSession(input = {}) {
  const opts = typeof input === "string" ? { passphrase: input } : input;
  const row = opts.pid ? await getCloudRow(opts.pid) : await getAnyCloudRow();
  const salt = opts.salt ?? row?.salt;
  const verifier = verifierFromText(opts.verifier ?? row?.verifier);
  if (!verifier) throw new Error("No cloud verifier found.");

  const key = opts.recoveryKey
    ? await importRecoveryKey(opts.recoveryKey)
    : await deriveKey(opts.passphrase, salt);

  const ok = await checkVerifier(key, verifier);
  if (!ok) throw new Error("Cloud sync unlock failed.");

  sessionKey = key;
  sessionSalt = salt ?? null;
  sessionVerifier = verifier;
  return true;
}

export function clearSession() {
  sessionKey = null;
  sessionSalt = null;
  sessionVerifier = null;
  for (const pending of pushTimers.values()) clearTimeout(pending.timer);
  pushTimers.clear();
}

export function hasSyncSession() {
  return Boolean(sessionKey && sessionVerifier);
}

export { classifyConflict };
