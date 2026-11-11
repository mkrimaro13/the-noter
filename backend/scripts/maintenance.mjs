#!/usr/bin/env node
/**
 * Scheduled CouchDB maintenance for The Noter: tombstone purging and
 * compaction. It runs inside the compose network with the admin credentials
 * because the app user is not allowed to call `_purge` or `_compact`.
 *
 * Progress is recorded in the `meta:maintenance` document so the frontend can
 * show what the schedule has been doing. Every field is a millisecond epoch
 * unless stated otherwise:
 *
 * - `firstRun`        when the schedule first ran; legacy tombstones without a
 *                     `deletedAt` are only purged after `firstRun + retention`
 * - `lastCompaction`  when compaction was last requested (skipped cycles keep
 *                     the previous value)
 * - `lastPurge`       when the purge step last ran, even if nothing was old
 *                     enough to purge
 * - `purged`          cumulative number of revisions removed from the database
 * - `intervalSeconds` the configured cycle interval, for display
 */

import { setTimeout as sleep } from 'node:timers/promises';
import { pathToFileURL } from 'node:url';

const MAINTENANCE_DOC_ID = 'meta:maintenance';
const DEFAULT_INTERVAL_SECONDS = 6 * 60 * 60;
const DEFAULT_RETENTION_DAYS = 30;

export function readConfig(env = process.env) {
  const url = String(env.COUCHDB_URL ?? 'http://127.0.0.1:5984').replace(/\/+$/, '');
  const db = String(env.COUCHDB_DB ?? 'thenoter');
  return {
    url,
    db,
    dbUrl: `${url}/${encodeURI(db)}`,
    username: String(env.COUCHDB_USER ?? 'admin'),
    password: String(env.COUCHDB_PASSWORD ?? ''),
    intervalSeconds: positiveNumber(env.MAINTENANCE_INTERVAL_SECONDS, DEFAULT_INTERVAL_SECONDS),
    retentionDays: positiveNumber(env.MAINTENANCE_RETENTION_DAYS, DEFAULT_RETENTION_DAYS),
  };
}

/** Waits until CouchDB answers `/_up`, retrying with a delay in between. */
export async function waitForServer(config, options = {}) {
  const attempts = options.attempts ?? 30;
  const delayMs = options.delayMs ?? 1_000;
  const fetchImpl = options.fetch ?? globalThis.fetch;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetchImpl(`${config.url}/_up`);
      if (response.ok) return;
    } catch {
      // Not listening yet; try again after the delay.
    }
    if (attempt < attempts) await sleep(delayMs);
  }
  throw new Error(`CouchDB at ${config.url} did not become ready in time.`);
}

/**
 * One maintenance pass: reads the progress document, purges tombstones that
 * are older than the retention window, requests compaction when the database
 * is not already compacting, and saves the updated progress. Returns a small
 * summary for logging and tests.
 */
export async function runCycle(config, fetchImpl = globalThis.fetch) {
  const now = Date.now();
  const retentionMs = config.retentionDays * 24 * 60 * 60 * 1000;

  const { progress, rev } = await readProgress(config, fetchImpl);
  const firstRun = typeof progress.firstRun === 'number' ? progress.firstRun : now;
  const purgedSoFar = typeof progress.purged === 'number' ? progress.purged : 0;

  const tombstones = await listTombstones(config, fetchImpl);
  const targets = tombstones.filter((doc) => {
    const deletedAt = typeof doc.deletedAt === 'number' ? doc.deletedAt : null;
    if (deletedAt !== null) return deletedAt <= now - retentionMs;
    // Tombstones written before `deletedAt` existed are aged from the first
    // run, so nothing disappears the moment the schedule starts.
    return now >= firstRun + retentionMs;
  });

  const purged = targets.length > 0 ? await purgeDocs(config, targets, fetchImpl) : 0;

  let compacted = false;
  const info = await dbInfo(config, fetchImpl);
  if (info.compact_running === true) {
    // Compaction is still working through the previous request.
  } else {
    const response = await fetchImpl(`${config.dbUrl}/_compact`, {
      method: 'POST',
      headers: authHeaders(config),
    });
    if (response.status !== 202) {
      throw new Error(`Compaction was not accepted (HTTP ${response.status}).`);
    }
    compacted = true;
  }

  await writeProgress(
    config,
    fetchImpl,
    {
      firstRun,
      lastCompaction: compacted ? now : numberOr(progress.lastCompaction, null),
      lastPurge: now,
      purged: purgedSoFar + purged,
      intervalSeconds: config.intervalSeconds,
      at: now,
    },
    rev,
  );

  return { purged, compacted, tombstones: tombstones.length };
}

/** Runs forever: one cycle now, then one per configured interval. */
export async function main(env = process.env) {
  const config = readConfig(env);
  await waitForServer(config);
  log(`connected to ${config.dbUrl}, cycling every ${config.intervalSeconds}s.`);

  const cycle = async () => {
    try {
      const result = await runCycle(config);
      log(
        `purged ${result.purged} of ${result.tombstones} tombstone(s); ` +
          `compaction ${result.compacted ? 'requested' : 'skipped (already running)'}.`,
      );
    } catch (error) {
      log(`cycle failed: ${errorMessage(error)} (retrying next interval).`);
    }
  };

  await cycle();
  const timer = setInterval(() => void cycle(), config.intervalSeconds * 1_000);

  const stop = () => {
    clearInterval(timer);
    process.exit(0);
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
}

function authHeaders(config) {
  const token = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  return { authorization: `Basic ${token}` };
}

async function readProgress(config, fetchImpl) {
  const response = await fetchImpl(progressUrl(config), { headers: authHeaders(config) });
  if (response.status === 404) return { progress: {}, rev: null };
  if (!response.ok) {
    throw new Error(`Could not read the maintenance document (HTTP ${response.status}).`);
  }
  const doc = await response.json().catch(() => null);
  if (typeof doc !== 'object' || doc === null) return { progress: {}, rev: null };
  return { progress: doc, rev: typeof doc._rev === 'string' ? doc._rev : null };
}

async function writeProgress(config, fetchImpl, fields, rev) {
  const body = { _id: MAINTENANCE_DOC_ID, ...fields };
  if (rev) body['_rev'] = rev;
  const response = await fetchImpl(progressUrl(config), {
    method: 'PUT',
    headers: { ...authHeaders(config), 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (response.status !== 201 && response.status !== 202) {
    throw new Error(`Could not save the maintenance document (HTTP ${response.status}).`);
  }
  const saved = await response.json().catch(() => null);
  return typeof saved?.rev === 'string' ? saved.rev : null;
}

function progressUrl(config) {
  return `${config.dbUrl}/${encodeURIComponent(MAINTENANCE_DOC_ID)}`;
}

/**
 * Lists deleted documents. CouchDB 3.4+ hides tombstones unless
 * `include_deleted` is passed; older servers reject the parameter but include
 * tombstones in the changes feed, so that is the fallback.
 */
async function listTombstones(config, fetchImpl) {
  const response = await fetchImpl(
    `${config.dbUrl}/_all_docs?include_deleted=true&include_docs=true`,
    { headers: authHeaders(config) },
  );
  if (response.ok) {
    const body = await response.json().catch(() => null);
    const rows = Array.isArray(body?.rows) ? body.rows : [];
    return rows
      .filter((row) => row?.value?.deleted === true && typeof row.doc === 'object' && row.doc !== null)
      .map((row) => row.doc);
  }

  const changes = await fetchImpl(`${config.dbUrl}/_changes?since=0&include_docs=true`, {
    headers: authHeaders(config),
  });
  if (!changes.ok) {
    throw new Error(`Could not list deleted documents (HTTP ${changes.status}).`);
  }
  const body = await changes.json().catch(() => null);
  const rows = Array.isArray(body?.results) ? body.results : [];
  return rows
    .filter((row) => row?.deleted === true && typeof row.doc === 'object' && row.doc !== null)
    .map((row) => row.doc);
}

async function purgeDocs(config, docs, fetchImpl) {
  const target = {};
  for (const doc of docs) {
    const rev = typeof doc._rev === 'string' ? doc._rev : '';
    const id = typeof doc._id === 'string' ? doc._id : '';
    if (id && rev) target[id] = [rev];
  }
  if (Object.keys(target).length === 0) return 0;

  const response = await fetchImpl(`${config.dbUrl}/_purge`, {
    method: 'POST',
    headers: { ...authHeaders(config), 'content-type': 'application/json' },
    body: JSON.stringify(target),
  });
  if (!response.ok) {
    throw new Error(`Purge was not accepted (HTTP ${response.status}).`);
  }
  const body = await response.json().catch(() => null);
  const purged = Object.values(body?.purged ?? {});
  return purged.reduce(
    (total, revs) => total + (Array.isArray(revs) ? revs.length : 0),
    0,
  );
}

async function dbInfo(config, fetchImpl) {
  const response = await fetchImpl(config.dbUrl, { headers: authHeaders(config) });
  if (!response.ok) {
    throw new Error(`Could not read the database info (HTTP ${response.status}).`);
  }
  return await response.json().catch(() => ({}));
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function numberOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function log(message) {
  process.stdout.write(`[maintenance ${new Date().toISOString()}] ${message}\n`);
}

// Only act as a daemon when executed directly, not when imported by tests.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(`[maintenance] fatal: ${errorMessage(error)}\n`);
    process.exit(1);
  });
}
