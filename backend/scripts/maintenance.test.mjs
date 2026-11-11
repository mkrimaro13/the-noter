// Tests for the CouchDB maintenance schedule. The server is a small in-process
// CouchDB emulator built on node:http, so no real database is needed.
// Run with: node --test backend/scripts/maintenance.test.mjs

import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { readConfig, runCycle, waitForServer } from './maintenance.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Starts a CouchDB look-alike. Documents live in a Map; deleted entries are
 * tombstones. `options.upFailures` makes `/_up` answer 500 that many times
 * first, and `supportIncludeDeleted: false` emulates servers older than 3.4
 * that reject the parameter on `_all_docs`.
 */
function startCouch(options = {}) {
  const requests = [];
  const docs = new Map(); // id -> { rev, body, deleted }
  let revisions = 0;
  let purgeSeq = 0;
  let compactRequests = 0;
  let upFailures = options.upFailures ?? 0;

  const store = (id, body, deleted = false) => {
    revisions += 1;
    const rev = `${revisions}-rev`;
    docs.set(id, { rev, body: { ...body, _id: id, _rev: rev }, deleted });
    return rev;
  };

  const server = createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      const payload = text ? JSON.parse(text) : null;
      const url = new URL(request.url, 'http://localhost');
      const send = (status, json) => {
        response.writeHead(status, { 'content-type': 'application/json' });
        response.end(JSON.stringify(json));
      };
      requests.push({ method: request.method, path: url.pathname, query: url.searchParams });

      if (url.pathname === '/_up') {
        if (upFailures > 0) {
          upFailures -= 1;
          return send(500, { error: 'not ready' });
        }
        return send(200, { status: 'ok' });
      }

      if (url.pathname === '/thenoter' && request.method === 'GET') {
        return send(200, {
          db_name: 'thenoter',
          doc_count: [...docs.values()].filter((entry) => !entry.deleted).length,
          doc_del_count: [...docs.values()].filter((entry) => entry.deleted).length,
          purge_seq: String(purgeSeq),
          compact_running: options.compactRunning === true,
        });
      }

      if (url.pathname === '/thenoter/_compact' && request.method === 'POST') {
        compactRequests += 1;
        return send(202, { ok: true });
      }

      if (url.pathname === '/thenoter/_purge' && request.method === 'POST') {
        const purgedMap = {};
        for (const [id, revs] of Object.entries(payload)) {
          const entry = docs.get(id);
          if (entry && Array.isArray(revs) && revs.includes(entry.rev)) {
            docs.delete(id);
            purgedMap[id] = [entry.rev];
            purgeSeq += 1;
          }
        }
        return send(201, { purged: purgedMap, purge_seq: String(purgeSeq) });
      }

      if (url.pathname === '/thenoter/_all_docs') {
        if (options.supportIncludeDeleted === false && url.searchParams.get('include_deleted')) {
          return send(400, { error: 'illegal_queried_param' });
        }
        const rows = [...docs.entries()].map(([id, entry]) => ({
          id,
          key: id,
          value: { rev: entry.rev, deleted: entry.deleted },
          doc: url.searchParams.get('include_docs') ? entry.body : undefined,
        }));
        return send(200, { total_rows: rows.length, rows });
      }

      if (url.pathname === '/thenoter/_changes') {
        const results = [...docs.entries()].map(([id, entry]) => ({
          id,
          changes: [{ rev: entry.rev }],
          deleted: entry.deleted,
          doc: entry.deleted ? entry.body : undefined,
        }));
        return send(200, { results, last_seq: 5 });
      }

      const maintenanceId = decodeURIComponent(url.pathname).endsWith('/meta:maintenance');
      if (maintenanceId && request.method === 'GET') {
        const entry = docs.get('meta:maintenance');
        if (!entry || entry.deleted) return send(404, { error: 'not_found' });
        return send(200, entry.body);
      }
      if (maintenanceId && request.method === 'PUT') {
        store('meta:maintenance', payload);
        return send(201, { ok: true, id: 'meta:maintenance', rev: `${revisions}-rev` });
      }

      send(404, { error: 'not_found' });
    });
  });

  return {
    requests,
    docs,
    store,
    compactCount: () => compactRequests,
    start: () =>
      new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
          resolve({ url: `http://127.0.0.1:${server.address().port}` });
        });
      }),
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function configFor(baseUrl, patch = {}) {
  return readConfig({
    COUCHDB_URL: baseUrl,
    COUCHDB_USER: 'admin',
    COUCHDB_PASSWORD: 'secret',
    COUCHDB_DB: 'thenoter',
    ...patch,
  });
}

test('readConfig applies defaults and environment overrides', () => {
  const defaults = readConfig({});
  assert.equal(defaults.url, 'http://127.0.0.1:5984');
  assert.equal(defaults.db, 'thenoter');
  assert.equal(defaults.dbUrl, 'http://127.0.0.1:5984/thenoter');
  assert.equal(defaults.intervalSeconds, 6 * 60 * 60);
  assert.equal(defaults.retentionDays, 30);

  const trailing = readConfig({ COUCHDB_URL: 'http://couch:5984/' });
  assert.equal(trailing.dbUrl, 'http://couch:5984/thenoter');

  const custom = configFor('http://couch:5984', {
    MAINTENANCE_INTERVAL_SECONDS: '3600',
    MAINTENANCE_RETENTION_DAYS: '7',
  });
  assert.equal(custom.intervalSeconds, 3600);
  assert.equal(custom.retentionDays, 7);

  const invalid = configFor('http://couch:5984', {
    MAINTENANCE_INTERVAL_SECONDS: 'nope',
    MAINTENANCE_RETENTION_DAYS: '-1',
  });
  assert.equal(invalid.intervalSeconds, 6 * 60 * 60);
  assert.equal(invalid.retentionDays, 30);
});

test('waitForServer retries until CouchDB answers', async () => {
  const couch = startCouch({ upFailures: 2 });
  const { url } = await couch.start();
  try {
    const config = configFor(url);
    await waitForServer(config, { attempts: 5, delayMs: 5 });
  } finally {
    await couch.close();
  }
});

test('waitForServer gives up after the configured attempts', async () => {
  const couch = startCouch({ upFailures: 99 });
  const { url } = await couch.start();
  try {
    const config = configFor(url);
    await assert.rejects(waitForServer(config, { attempts: 2, delayMs: 5 }), /did not become ready/);
  } finally {
    await couch.close();
  }
});

test('runCycle purges aged tombstones, keeps fresh ones, and compacts', async () => {
  const couch = startCouch();
  const { url } = await couch.start();
  try {
    couch.store('note:old', { type: 'note', deletedAt: Date.now() - 40 * DAY_MS }, true);
    couch.store('note:fresh', { type: 'note', deletedAt: Date.now() - 1_000 }, true);
    couch.store('note:alive', { type: 'note', title: 'Kept' });

    const result = await runCycle(configFor(url));

    assert.deepEqual(result, { purged: 1, compacted: true, tombstones: 2 });
    assert.equal(couch.docs.has('note:old'), false);
    assert.equal(couch.docs.has('note:fresh'), true);
    assert.equal(couch.docs.has('note:alive'), true);
    assert.equal(couch.compactCount(), 1);

    const progress = couch.docs.get('meta:maintenance')?.body;
    assert.equal(typeof progress.firstRun, 'number');
    assert.equal(typeof progress.lastCompaction, 'number');
    assert.equal(typeof progress.lastPurge, 'number');
    assert.equal(progress.purged, 1);
    assert.equal(progress.intervalSeconds, 6 * 60 * 60);
  } finally {
    await couch.close();
  }
});

test('runCycle purges legacy tombstones only after firstRun plus retention', async () => {
  const couch = startCouch();
  const { url } = await couch.start();
  try {
    // A tombstone written before `deletedAt` existed.
    couch.store('note:legacy', { type: 'note' }, true);

    // First cycle: firstRun is recorded, nothing old enough yet.
    const first = await runCycle(configFor(url));
    assert.equal(first.purged, 0);
    assert.equal(couch.docs.has('note:legacy'), true);

    // Simulate the retention window having passed since the first run.
    couch.store('meta:maintenance', {
      firstRun: Date.now() - 40 * DAY_MS,
      lastCompaction: 1,
      lastPurge: 1,
      purged: 3,
      intervalSeconds: 21600,
    });

    const second = await runCycle(configFor(url));
    assert.equal(second.purged, 1);
    assert.equal(couch.docs.has('note:legacy'), false);

    // The purge counter accumulates across cycles.
    const progress = couch.docs.get('meta:maintenance')?.body;
    assert.equal(progress.purged, 4);
  } finally {
    await couch.close();
  }
});

test('runCycle skips compaction while the database is compacting', async () => {
  const couch = startCouch({ compactRunning: true });
  const { url } = await couch.start();
  try {
    const result = await runCycle(configFor(url));

    assert.equal(result.compacted, false);
    assert.equal(couch.compactCount(), 0);
    const progress = couch.docs.get('meta:maintenance')?.body;
    assert.equal(progress.lastCompaction, null);
  } finally {
    await couch.close();
  }
});

test('runCycle falls back to the changes feed when include_deleted is rejected', async () => {
  const couch = startCouch({ supportIncludeDeleted: false });
  const { url } = await couch.start();
  try {
    couch.store('note:old', { type: 'note', deletedAt: Date.now() - 40 * DAY_MS }, true);

    const result = await runCycle(configFor(url));

    assert.equal(result.purged, 1);
    assert.equal(couch.docs.has('note:old'), false);
    const allDocs = couch.requests.filter((request) => request.path === '/thenoter/_all_docs');
    assert.equal(allDocs.length, 1, 'the rejected _all_docs variant is not retried');
    assert.ok(
      couch.requests.some((request) => request.path === '/thenoter/_changes'),
      'the fallback feed is used',
    );
  } finally {
    await couch.close();
  }
});

test('runCycle updates the progress document through its revision', async () => {
  const couch = startCouch();
  const { url } = await couch.start();
  try {
    couch.store('meta:maintenance', { firstRun: 5, lastCompaction: 6, lastPurge: 7, purged: 9 });

    await runCycle(configFor(url));
    await runCycle(configFor(url));

    const progress = couch.docs.get('meta:maintenance')?.body;
    assert.equal(progress.firstRun, 5, 'the first run is never rewritten');
    assert.equal(progress.purged, 9, 'no tombstones were available to purge');
    assert.ok(progress.lastPurge > 7);
    assert.ok(progress.lastCompaction > 6);

    // Exactly one progress document exists, rewritten in place.
    assert.equal(couch.docs.has('meta:maintenance'), true);
    assert.equal(couch.docs.size, 1);
  } finally {
    await couch.close();
  }
});
