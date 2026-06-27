// ─── ECON STUDIO · services/sync/shareEngine.js ──────────────────────────────
// Project sharing: owner creates an independently-encrypted copy of a project
// keyed by a random token. The share URL embeds the token; the recipient logs
// in, the app derives the key from the token, decrypts, and imports locally.
//
// Key derivation:  key = PBKDF2(token, salt, 310_000, SHA-256, AES-256-GCM)
// Storage path:    shares/{token}/{artifactName}.enc  inside synced-blobs
// Can-edit:        stored but push-back deferred to phase 2.

import {
  randomSaltB64,
  deriveKey,
  encryptBytes,
  decryptBytes,
  encryptJSON,
  decryptJSON,
  makeVerifier,
  checkVerifier,
  sha256B64,
  bytesToB64,
  b64ToBytes,
} from "./crypto.js";
import { getSyncSupabase, getCurrentUserId } from "./supabaseClient.js";
import {
  loadDatasetRegistry,
  loadProjectPipelines,
  loadRawData,
  loadWorkbenchRecord,
  loadCoachChats,
  loadModelBuffer,
  loadSpatialMaps,
  listProjects,
  saveProject,
  saveDatasetRegistry,
  savePipeline,
  saveRawData,
  saveWorkbenchRecord,
  saveCoachChats,
  saveModelBuffer,
  saveSpatialMaps,
} from "../Persistence/indexedDB.js";
import { assertSafePulledPipelines } from "./syncEngine.js";

const BUCKET = "synced-blobs";

// ── Helpers ───────────────────────────────────────────────────────────────────

function encode(value) {
  return new TextEncoder().encode(JSON.stringify(value ?? null));
}

function decode(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return bytesToB64(bytes).replace(/[+/=]/g, c => ({ "+": "a", "/": "b", "=": "" }[c]));
}

function sharePath(token, key) {
  return `shares/${token}/${encodeURIComponent(key)}.enc`;
}

async function uploadArtifact(supabase, token, key, ct) {
  const path = sharePath(token, key);
  const { error } = await supabase.storage.from(BUCKET).upload(path, ct, {
    upsert: true,
    contentType: "text/plain;charset=utf-8",
  });
  if (error) throw error;
}

async function downloadArtifact(supabase, token, key) {
  const path = sharePath(token, key);
  const { data, error } = await supabase.storage.from(BUCKET).download(path);
  if (error) throw error;
  if (typeof data === "string") return data;
  if (data?.text) return data.text();
  return new TextDecoder().decode(new Uint8Array(await data.arrayBuffer()));
}

async function deleteArtifacts(supabase, token, artifactKeys) {
  const paths = artifactKeys.map(k => sharePath(token, k));
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}

// ── Bundle read/write (mirrors syncEngine) ────────────────────────────────────

async function readProjectBundle(pid) {
  const project = (await listProjects()).find(p => p.pid === pid);
  if (!project) throw new Error("Project not found.");

  const datasetRegistry = await loadDatasetRegistry(pid);
  const datasetIds = new Set([pid, ...(datasetRegistry ?? []).map(d => d?.id).filter(Boolean)]);
  const rawData = {};
  for (const dsId of datasetIds) {
    const data = await loadRawData(dsId);
    if (data) rawData[dsId] = data;
  }

  return {
    project,
    pipelines:       await loadProjectPipelines(pid),
    datasetRegistry: datasetRegistry ?? [],
    rawData,
    workbench:       await loadWorkbenchRecord(pid),
    coachChats:      await loadCoachChats(pid),
    modelBuffer:     await loadModelBuffer(pid),
    spatialMaps:     await loadSpatialMaps(pid),
  };
}

function artifactEntries(bundle) {
  const entries = [
    ["project_meta",     bundle.project],
    ["pipelines",        bundle.pipelines],
    ["dataset_registry", bundle.datasetRegistry],
    ["workbench",        bundle.workbench],
    ["coach_chats",      bundle.coachChats],
    ["model_buffer",     bundle.modelBuffer],
    ["spatial_maps",     bundle.spatialMaps],
  ];
  for (const [dsId, raw] of Object.entries(bundle.rawData ?? {})) {
    entries.push([`raw_data:${dsId}`, raw]);
  }
  return entries.filter(([, v]) => v !== undefined);
}

async function encryptAndUpload(supabase, token, encKey, bundle) {
  const index = [];
  for (const [key, value] of artifactEntries(bundle)) {
    const bytes = encode(value);
    const hash  = await sha256B64(bytes);
    const { ct, iv } = await encryptBytes(encKey, bytes);
    await uploadArtifact(supabase, token, key, ct);
    index.push({ key, iv, hash });
  }
  return index;
}

async function decryptBundle(supabase, token, encKey, index) {
  const bundle = { rawData: {} };
  for (const entry of index) {
    const ct    = await downloadArtifact(supabase, token, entry.key);
    const bytes = await decryptBytes(encKey, ct, entry.iv);
    const value = decode(bytes);
    if (entry.key.startsWith("raw_data:")) {
      bundle.rawData[entry.key.slice("raw_data:".length)] = value;
    } else {
      const map = {
        project_meta:     "project",
        pipelines:        "pipelines",
        dataset_registry: "datasetRegistry",
        workbench:        "workbench",
        coach_chats:      "coachChats",
        model_buffer:     "modelBuffer",
        spatial_maps:     "spatialMaps",
      };
      bundle[map[entry.key] ?? entry.key] = value;
    }
  }
  assertSafePulledPipelines(bundle.pipelines);
  return bundle;
}

async function writeBundle(targetPid, bundle) {
  await saveProject(targetPid, { ...(bundle.project ?? {}), pid: targetPid });

  if (Array.isArray(bundle.datasetRegistry)) {
    await saveDatasetRegistry(targetPid, bundle.datasetRegistry);
  }
  for (const [dsId, raw] of Object.entries(bundle.rawData ?? {})) {
    await saveRawData(dsId, raw);
  }

  const pipelineRecord = bundle.pipelines ?? {};
  for (const [dsId, record] of Object.entries(pipelineRecord.datasetPipelines ?? {})) {
    await savePipeline(targetPid, dsId, {
      ...record,
      filename:       pipelineRecord.filename,
      rowCount:       pipelineRecord.rowCount,
      colCount:       pipelineRecord.colCount,
      pipelineLength: pipelineRecord.pipelineLength,
    });
  }

  if (bundle.workbench)  await saveWorkbenchRecord(targetPid, bundle.workbench.sessions ?? []);
  if (bundle.coachChats) await saveCoachChats(targetPid, bundle.coachChats.conversations ?? []);
  if (bundle.modelBuffer) await saveModelBuffer(targetPid, bundle.modelBuffer.models ?? []);
  if (bundle.spatialMaps) await saveSpatialMaps(targetPid, bundle.spatialMaps.maps ?? null);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Owner creates a share for a project.
 * Returns { shareId, token, shareUrl } — owner copies/sends the URL.
 */
const SHARE_LIMITS = { free: 1, pro: 5, premium: 20 };

export async function createShare(pid, recipientEmail, canEdit = false) {
  const supabase = getSyncSupabase();
  const userId   = await getCurrentUserId();
  if (!userId) throw new Error("Sign in before sharing.");

  // ── Tier limit check ────────────────────────────────────────────────────────
  const { data: prof } = await supabase.from("profiles").select("tier").eq("id", userId).single();
  const tier  = prof?.tier ?? "free";
  const limit = SHARE_LIMITS[tier] ?? SHARE_LIMITS.free;

  const { count } = await supabase
    .from("project_shares").select("id", { count: "exact", head: true })
    .eq("owner_id", userId).eq("pid", pid);

  if ((count ?? 0) >= limit) {
    const tierLabel = tier === "free" ? "Free" : tier === "pro" ? "Pro" : "Premium";
    throw new Error(
      `Share limit reached (${tierLabel} plan: ${limit} share${limit === 1 ? "" : "s"} per project). ` +
      `Revoke an existing share or upgrade your plan.`
    );
  }
  // ────────────────────────────────────────────────────────────────────────────

  const token  = randomToken();
  const salt   = randomSaltB64();
  const encKey = await deriveKey(token, salt);
  const verifier = await makeVerifier(encKey);

  // Resolve project name for display in recipient's "Shared with me" list
  const projectName = (await listProjects()).find(p => p.pid === pid)?.name ?? null;

  // Insert the DB row FIRST so storage RLS policies can verify ownership
  // via the project_shares row when artifact uploads arrive.
  const { data, error } = await supabase.from("project_shares").insert({
    owner_id:        userId,
    pid,
    name:            projectName,
    recipient_email: recipientEmail.trim().toLowerCase(),
    can_edit:        canEdit,
    token,
    salt,
    verifier:        JSON.stringify(verifier),  // indexIv added in final update below
    version:         1,
  }).select("id").single();
  if (error) throw error;

  // Read, encrypt, and upload bundle (storage RLS now passes — row exists)
  const bundle = await readProjectBundle(pid);
  const index  = await encryptAndUpload(supabase, token, encKey, bundle);

  // Encrypt + upload artifact index
  const idxBytes  = encode(index);
  const { ct: idxCt, iv: idxIv } = await encryptBytes(encKey, idxBytes);
  await uploadArtifact(supabase, token, "__index__", idxCt);

  // Persist the IV for the index in the share row
  await supabase.from("project_shares")
    .update({ verifier: JSON.stringify({ ...verifier, indexIv: idxIv }) })
    .eq("id", data.id);

  const shareUrl = `${window.location.origin}/?share=${token}`;
  return { shareId: data.id, token, shareUrl };
}

/**
 * List shares the current user has created for a given project pid.
 */
export async function listMyShares(pid) {
  const supabase = getSyncSupabase();
  const { data, error } = await supabase
    .from("project_shares")
    .select("id,pid,name,recipient_email,can_edit,token,version,created_at")
    .eq("pid", pid)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * List all shares addressed to the current user's account email.
 */
export async function listSharedWithMe() {
  const supabase = getSyncSupabase();
  const { data, error } = await supabase
    .from("project_shares")
    .select("id,pid,name,recipient_email,can_edit,token,version,created_at,owner_id")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Recipient pulls a shared project into local IndexedDB.
 * token comes from the URL query param.
 * Returns the new local pid.
 */
export async function pullShare(token) {
  const supabase = getSyncSupabase();

  // Fetch share row (recipient read policy requires matching email)
  const { data: row, error } = await supabase
    .from("project_shares")
    .select("*")
    .eq("token", token)
    .maybeSingle();
  if (error) throw error;
  if (!row) throw new Error("Share not found or you are not the intended recipient.");

  const encKey  = await deriveKey(token, row.salt);
  const verifierObj = JSON.parse(row.verifier);

  // Verify key
  const ok = await checkVerifier(encKey, { ct: verifierObj.ct, iv: verifierObj.iv });
  if (!ok) throw new Error("Share key verification failed.");

  // Download + decrypt artifact index
  const idxCt    = await downloadArtifact(supabase, token, "__index__");
  const idxBytes = await decryptBytes(encKey, idxCt, verifierObj.indexIv);
  const index    = decode(idxBytes);

  // Decrypt full bundle
  const bundle = await decryptBundle(supabase, token, encKey, index);

  // Save locally — use original pid (will overwrite if already present)
  const targetPid = row.pid;
  await writeBundle(targetPid, bundle);
  return targetPid;
}

/**
 * Owner revokes a share: deletes the DB row + storage artifacts.
 */
export async function revokeShare(shareId) {
  const supabase = getSyncSupabase();

  // Get the row first to know the token
  const { data: row, error: fetchErr } = await supabase
    .from("project_shares")
    .select("token")
    .eq("id", shareId)
    .single();
  if (fetchErr) throw fetchErr;

  // List and delete artifacts
  const prefix = `shares/${row.token}`;
  const { data: listed, error: listErr } = await supabase.storage
    .from(BUCKET)
    .list(prefix);
  if (listErr) throw listErr;

  const paths = (listed ?? []).map(obj => `${prefix}/${obj.name}`);
  if (paths.length) {
    const { error: delErr } = await supabase.storage.from(BUCKET).remove(paths);
    if (delErr) throw delErr;
  }

  // Delete DB row
  const { error: dbErr } = await supabase
    .from("project_shares")
    .delete()
    .eq("id", shareId);
  if (dbErr) throw dbErr;
}
