import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const compose = await readFile(
  new URL('../docker/m5/compose.yaml', import.meta.url),
  'utf8',
);
const updater = await readFile(
  new URL('../scripts/update-m5-dual-stack.sh', import.meta.url),
  'utf8',
);
const dockerfile = await readFile(
  new URL('../docker/den-srv/Dockerfile', import.meta.url),
  'utf8',
);

assert.match(compose, /crew-a:/);
assert.match(compose, /crew-b:/);
assert.match(compose, /0\.0\.0\.0:9347:9347/);
assert.match(compose, /0\.0\.0\.0:9348:9347/);
assert.match(compose, /instances\/a\/data:\/srv\/rusty-crew\/data/);
assert.match(compose, /instances\/b\/data:\/srv\/rusty-crew\/data/);
assert.match(compose, /host\.docker\.internal:host-gateway/);
assert.match(compose, /restart: unless-stopped/);

assert.match(updater, /status --porcelain=v1 --untracked-files=all/);
assert.match(updater, /merge --ff-only origin\/main/);
assert.match(updater, /trap rollback ERR/);
assert.match(updater, /restoring the prior paired image/);
assert.match(updater, /check_sqlite_isolation/);
assert.match(updater, /host\.docker\.internal:5199\/mcp/);
assert.match(updater, /deployed-revisions\.json/);

assert.match(dockerfile, /AS view-builder/);
assert.match(
  dockerfile,
  /COPY --from=view-builder .*\/opt\/rusty-view\/site\//,
);

console.log('m5 dual-stack deployment contract: ok');
