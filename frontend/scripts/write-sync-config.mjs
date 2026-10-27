// Generate the browser sync config from the repository's .env file.
//
// Development: `npm start` runs this before the dev server, so the app reads
// frontend/public/sync-config.json.
// Docker: the build context has no root .env, so this writes a disabled config;
// the nginx entrypoint replaces it at container start with the compose values.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(here, '..');
const repoRoot = resolve(frontendRoot, '..');
const envPath = resolve(repoRoot, '.env');
const outputPath = resolve(frontendRoot, 'public/sync-config.json');

const fileEnv = readEnvFile(envPath);
const url = pick('SYNC_URL');
const username = pick('COUCHDB_APP_USER');
const password = pick('COUCHDB_APP_PASSWORD');

mkdirSync(dirname(outputPath), { recursive: true });

if (!url || !username || !password) {
  writeFileSync(outputPath, `${JSON.stringify({ enabled: false }, null, 2)}\n`);
  console.log('Sync config: disabled (SYNC_URL, COUCHDB_APP_USER or COUCHDB_APP_PASSWORD missing).');
} else {
  const config = {
    enabled: true,
    url: url.replace(/\/+$/, ''),
    username,
    password,
  };
  writeFileSync(outputPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log(`Sync config: enabled for ${config.url} as ${username}.`);
}

function pick(key) {
  return process.env[key] ?? fileEnv[key] ?? '';
}

function readEnvFile(path) {
  try {
    const env = {};
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || line.trimStart().startsWith('#')) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      env[match[1]] = value;
    }
    return env;
  } catch {
    return {};
  }
}
