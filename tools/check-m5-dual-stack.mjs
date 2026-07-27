import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const updater = await readFile(
  new URL('../scripts/update-m5-dual-stack.sh', import.meta.url),
  'utf8',
);
const unit = await readFile(
  new URL('../deploy/m5/rusty-crew-m5@.service', import.meta.url),
  'utf8',
);
const dockerfile = await readFile(
  new URL('../docker/den-srv/Dockerfile', import.meta.url),
  'utf8',
);

assert.match(unit, /User=jb/);
assert.match(unit, /Group=jb/);
assert.match(unit, /SupplementaryGroups=docker/);
assert.match(unit, /Environment=HOME=\/home\/jb/);
assert.match(
  unit,
  /EnvironmentFile=.*instances\/%i\/native-config\/service\.env/,
);
assert.match(
  unit,
  /EnvironmentFile=-.*instances\/%i\/config\/adapter-secrets\.env/,
);
assert.match(unit, /WorkingDirectory=.*current\/crew/);
assert.match(unit, /ExecStartPre=.*current\/bin\/tsx .*preflight\.ts/);
assert.match(unit, /ExecStart=.*current\/bin\/tsx .*start\.ts/);
assert.match(unit, /WantedBy=multi-user\.target/);
assert.doesNotMatch(unit, /ProtectHome|InaccessiblePaths|ReadOnlyPaths/);

assert.match(updater, /status --porcelain=v1 --untracked-files=all/);
assert.match(updater, /merge --ff-only origin\/main/);
assert.match(updater, /deploymentMode.*host-native-systemd/);
assert.match(updater, /write_instance_config a 9347/);
assert.match(updater, /write_instance_config b 9348/);
assert.match(updater, /instances\/a/);
assert.match(updater, /instances\/b/);
assert.match(updater, /check_sqlite_isolation|SQLite isolation failed/);
assert.match(updater, /http:\/\/127\.0\.0\.1:5199\/mcp/);
assert.match(updater, /trap rollback ERR/);
assert.match(updater, /restoring the previous runtime/);
assert.match(updater, /start_legacy_containers/);
assert.match(updater, /legacy_config=.*\/config/);
assert.match(updater, /native_config=.*\/native-config/);
assert.match(updater, /--retire-docker/);
assert.match(updater, /dataDeleted.*false/);
assert.match(updater, /current\.next/);
assert.match(updater, /deployed-revisions\.json/);
assert.match(updater, /docker_stack cp .*\/opt\/rusty-crew/);
assert.match(updater, /docker_stack cp .*\/usr\/local\/bin\/node/);

assert.match(dockerfile, /AS view-builder/);
assert.match(
  dockerfile,
  /COPY --from=view-builder .*\/opt\/rusty-view\/site\//,
);

console.log('m5 native dual-stack deployment contract: ok');
