import assert from 'node:assert/strict';
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readlink,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const updaterSource = join(repoRoot, 'scripts/update-m5-dual-stack.sh');
const unitSource = join(repoRoot, 'deploy/m5/rusty-crew-m5@.service');
const root = await mkdtemp(join(tmpdir(), 'rusty-stack-native-test-'));
const stackRoot = join(root, 'stack');
const remotesRoot = join(root, 'remotes');
const seedsRoot = join(root, 'seeds');
const fakeBin = join(root, 'bin');
const stateRoot = join(root, 'state');
const currentUser = process.env.USER ?? 'agent';
const currentGroup =
  process.env.RUSTY_STACK_TEST_GROUP ??
  spawnSync('id', ['-gn'], { encoding: 'utf8' }).stdout.trim();

await Promise.all([
  mkdir(stackRoot, { recursive: true }),
  mkdir(remotesRoot, { recursive: true }),
  mkdir(seedsRoot, { recursive: true }),
  mkdir(fakeBin, { recursive: true }),
  mkdir(stateRoot, { recursive: true }),
]);

try {
  const crewRemote = await createRemote('rusty-crew', {
    'README.md': 'fixture crew\n',
  });
  const viewRemote = await createRemote('rusty-view', {
    'README.md': 'fixture view\n',
    'deploy/m5/rusty-crew-m5@.service': await readFile(unitSource, 'utf8'),
    'docker/den-srv/Dockerfile': 'FROM scratch\n',
  });
  await mkdir(join(stackRoot, 'repos'), { recursive: true });
  run('git', ['clone', crewRemote, join(stackRoot, 'repos/rusty-crew')]);
  run('git', ['clone', viewRemote, join(stackRoot, 'repos/rusty-view')]);

  for (const instance of ['a', 'b']) {
    const instanceRoot = join(stackRoot, 'instances', instance);
    await mkdir(join(instanceRoot, 'data/engine'), { recursive: true });
    await mkdir(join(instanceRoot, 'config'), { recursive: true });
    await writeFile(
      join(instanceRoot, 'data/engine/coordination.sqlite3'),
      `sqlite-${instance}`,
    );
    await writeFile(
      join(instanceRoot, 'config/service.env'),
      [
        'RUSTY_CREW_DATA_DIR=/srv/rusty-crew',
        'RUSTY_CREW_ADMIN_PORT=9347',
        'RUSTY_CREW_MCP_BASE_URL=http://host.docker.internal:5199/mcp',
        '',
      ].join('\n'),
    );
    await writeFile(
      join(instanceRoot, 'config/service.json'),
      `${JSON.stringify({
        profilesDir: '/srv/rusty-crew/config/profiles',
        skillsDir: '/srv/rusty-crew/config/skills',
        wakeTimeout: { mode: 'finite', timeoutMs: 60_000 },
        brains: [{ id: 'fixture-brain', providerId: 'fixture-provider' }],
        sessions: [
          {
            id: `${instance}-session`,
            profileId: 'ambassador',
            workdir: `/workspace/${instance}`,
            turnTimeoutMs: 120_000,
          },
        ],
        mcpServers: [
          {
            id: 'den',
            transport: 'http',
            url: 'http://127.0.0.1:5199/mcp',
          },
        ],
        profileRegistry: {
          ambassador: {
            mcpBindings: [{ serverId: 'den', toolNames: ['get_task'] }],
          },
        },
        fixtureCredentialRef: 'credential-preserved',
      })}\n`,
    );
  }

  await Promise.all([
    writeFile(join(stateRoot, 'container-rusty-crew-a'), 'running\n'),
    writeFile(join(stateRoot, 'container-rusty-crew-b'), 'running\n'),
    writeFile(join(stateRoot, 'docker-build-count'), '0\n'),
  ]);
  await installFakeCommands();

  const initialFailure = runUpdater([], {
    expectSuccess: false,
    extraEnv: { RUSTY_STACK_FAIL_CONFIG_INSTANCE: 'b' },
  });
  assert.match(
    `${initialFailure.stdout}\n${initialFailure.stderr}`,
    /restoring the previous runtime/,
  );
  assert.equal(
    await readFile(join(stateRoot, 'container-rusty-crew-a'), 'utf8'),
    'running\n',
  );
  assert.equal(
    await readFile(join(stateRoot, 'container-rusty-crew-b'), 'utf8'),
    'running\n',
  );
  await assertLegacyConfig('a');
  await assertLegacyConfig('b');
  await assertMissing(join(stackRoot, 'instances/a/native-config'));
  await assertMissing(join(stackRoot, 'instances/b/native-config'));
  await assertMissing(join(stackRoot, 'current'));

  const first = runUpdater([], { expectSuccess: true });
  assert.match(first.stdout, /Updated native A/);
  const manifest = JSON.parse(
    await readFile(join(stackRoot, 'deployed-revisions.json'), 'utf8'),
  );
  assert.equal(manifest.deploymentMode, 'host-native-systemd');
  assert.equal(manifest.serviceUser, currentUser);
  assert.equal(manifest.instances.a.port, 9347);
  assert.equal(manifest.instances.b.port, 9348);
  assert.notEqual(
    manifest.instances.a.sqliteIdentity,
    manifest.instances.b.sqliteIdentity,
  );
  assert.equal(
    await readFile(join(stateRoot, 'docker-build-count'), 'utf8'),
    '2\n',
  );
  await assertNativeConfig('a', 9347);
  await assertNativeConfig('b', 9348);
  await assertLegacyConfig('a');
  await assertLegacyConfig('b');
  await assertStoppedContainer('rusty-crew-a');
  await assertStoppedContainer('rusty-crew-b');

  const firstRelease = await readlink(join(stackRoot, 'current'));
  const noChange = runUpdater([], { expectSuccess: true });
  assert.match(noChange.stdout, /No source change/);
  assert.equal(
    await readFile(join(stateRoot, 'docker-build-count'), 'utf8'),
    '2\n',
  );
  assert.equal(await readlink(join(stackRoot, 'current')), firstRelease);

  const dirtyFile = join(stackRoot, 'repos/rusty-crew/untracked.txt');
  await writeFile(dirtyFile, 'dirty\n');
  const dirty = runUpdater(['--check-sources'], { expectSuccess: false });
  assert.match(dirty.stderr, /dirty; refusing an unreproducible update/);
  await rm(dirtyFile);

  await pushRemoteChange(viewRemote, 'README.md', 'fixture view v2\n');
  const nativeConfigA = await readFile(
    join(stackRoot, 'instances/a/native-config/service.env'),
    'utf8',
  );
  const nativeConfigB = await readFile(
    join(stackRoot, 'instances/b/native-config/service.env'),
    'utf8',
  );
  const configFailed = runUpdater([], {
    expectSuccess: false,
    extraEnv: { RUSTY_STACK_FAIL_CONFIG_INSTANCE: 'b' },
  });
  assert.match(
    `${configFailed.stdout}\n${configFailed.stderr}`,
    /restoring the previous runtime/,
  );
  assert.equal(await readlink(join(stackRoot, 'current')), firstRelease);
  assert.equal(
    await readFile(
      join(stackRoot, 'instances/a/native-config/service.env'),
      'utf8',
    ),
    nativeConfigA,
  );
  assert.equal(
    await readFile(
      join(stackRoot, 'instances/b/native-config/service.env'),
      'utf8',
    ),
    nativeConfigB,
  );
  assert.equal(
    await readFile(join(stateRoot, 'systemctl-active-a'), 'utf8'),
    'active\n',
  );
  assert.equal(
    await readFile(join(stateRoot, 'systemctl-active-b'), 'utf8'),
    'active\n',
  );

  await writeFile(join(stateRoot, 'fail-restart-once'), 'yes\n');
  const failed = runUpdater([], { expectSuccess: false });
  const failedOutput = `${failed.stdout}\n${failed.stderr}`;
  assert.match(
    failedOutput,
    /restoring the previous runtime/,
    `failed activation output tail:\n${failedOutput.slice(-5000)}`,
  );
  assert.equal(await readlink(join(stackRoot, 'current')), firstRelease);
  assert.equal(
    await readFile(join(stateRoot, 'systemctl-active-a'), 'utf8'),
    'active\n',
  );
  assert.equal(
    await readFile(join(stateRoot, 'systemctl-active-b'), 'utf8'),
    'active\n',
  );

  const recovered = runUpdater([], { expectSuccess: true });
  assert.match(recovered.stdout, /Updated native A/);
  const recoveredRelease = await readlink(join(stackRoot, 'current'));
  assert.notEqual(recoveredRelease, firstRelease);
  assert.match(
    recoveredRelease,
    /-retry-2$/,
    'fixed-time immediate retries must allocate collision-free release names',
  );

  runUpdater(['--retire-docker'], { expectSuccess: true });
  await assertMissing(join(stateRoot, 'container-rusty-crew-a'));
  await assertMissing(join(stateRoot, 'container-rusty-crew-b'));
  const retirement = JSON.parse(
    await readFile(join(stackRoot, 'docker-retired.json'), 'utf8'),
  );
  assert.equal(retirement.dataDeleted, false);
  await stat(join(stackRoot, 'instances/a/data/engine/coordination.sqlite3'));
  await stat(join(stackRoot, 'instances/b/data/engine/coordination.sqlite3'));

  console.log('m5 native updater fixture: ok');
} finally {
  await rm(root, { recursive: true, force: true });
}

async function createRemote(name, files) {
  const remote = join(remotesRoot, `${name}.git`);
  const seed = join(seedsRoot, name);
  run('git', ['init', '--bare', remote]);
  run('git', ['init', '--initial-branch=main', seed]);
  run('git', ['-C', seed, 'config', 'user.name', 'Rusty Stack Test']);
  run('git', [
    '-C',
    seed,
    'config',
    'user.email',
    'rusty-stack-test@example.invalid',
  ]);
  for (const [relativePath, content] of Object.entries(files)) {
    const target = join(seed, relativePath);
    await mkdir(resolve(target, '..'), { recursive: true });
    await writeFile(target, content);
  }
  run('git', ['-C', seed, 'add', '.']);
  run('git', ['-C', seed, 'commit', '-m', 'seed']);
  run('git', ['-C', seed, 'remote', 'add', 'origin', remote]);
  run('git', ['-C', seed, 'push', '-u', 'origin', 'main']);
  run('git', ['--git-dir', remote, 'symbolic-ref', 'HEAD', 'refs/heads/main']);
  return remote;
}

async function pushRemoteChange(remote, relativePath, content) {
  const seed = join(seedsRoot, basename(remote, '.git'));
  await writeFile(join(seed, relativePath), content);
  run('git', ['-C', seed, 'add', relativePath]);
  run('git', ['-C', seed, 'commit', '-m', 'fixture update']);
  run('git', ['-C', seed, 'push', 'origin', 'main']);
}

function runUpdater(args, { expectSuccess, extraEnv = {} }) {
  const bashArgs =
    process.env.RUSTY_STACK_TEST_TRACE === '1'
      ? ['-x', updaterSource, ...args]
      : [updaterSource, ...args];
  const result = spawnSync('bash', bashArgs, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${fakeBin}:${process.env.PATH}`,
      RUSTY_STACK_ROOT: stackRoot,
      RUSTY_STACK_USER: currentUser,
      RUSTY_STACK_GROUP: currentGroup,
      RUSTY_STACK_TEST_MODE: '1',
      RUSTY_STACK_UNIT_TARGET: join(root, 'rusty-crew-m5@.service'),
      RUSTY_CREW_GIT_URL: join(remotesRoot, 'rusty-crew.git'),
      RUSTY_VIEW_GIT_URL: join(remotesRoot, 'rusty-view.git'),
      RUSTY_STACK_TEST_STATE: stateRoot,
      RUSTY_STACK_RELEASE_TIMESTAMP: '20260727T000000Z',
      ...extraEnv,
    },
  });
  if (expectSuccess) {
    assert.equal(
      result.status,
      0,
      `updater failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
    );
  } else {
    assert.notEqual(result.status, 0, 'updater unexpectedly succeeded');
  }
  return result;
}

async function assertNativeConfig(instance, port) {
  const env = await readFile(
    join(stackRoot, 'instances', instance, 'native-config/service.env'),
    'utf8',
  );
  assert.match(env, new RegExp(`^RUSTY_CREW_ADMIN_PORT=${port}$`, 'm'));
  assert.match(
    env,
    /^RUSTY_CREW_MCP_BASE_URL=http:\/\/127\.0\.0\.1:5199\/mcp$/m,
  );
  assert.doesNotMatch(env, /host\.docker\.internal|\/srv\/rusty-crew/);
  const config = JSON.parse(
    await readFile(
      join(stackRoot, 'instances', instance, 'native-config/service.json'),
      'utf8',
    ),
  );
  assert.equal(
    config.profilesDir,
    join(stackRoot, 'instances', instance, 'config/profiles'),
  );
  assert.equal(
    config.skillsDir,
    join(stackRoot, 'instances', instance, 'config/skills'),
  );
  assert.equal('wakeTimeout' in config, false);
  assert.deepEqual(config.brains, [
    { id: 'fixture-brain', providerId: 'fixture-provider' },
  ]);
  assert.deepEqual(config.sessions, [
    {
      id: `${instance}-session`,
      profileId: 'ambassador',
      workdir: `/workspace/${instance}`,
    },
  ]);
  assert.deepEqual(config.mcpServers, [
    {
      id: 'den',
      transport: 'http',
      url: 'http://127.0.0.1:5199/mcp',
    },
  ]);
  assert.deepEqual(config.profileRegistry, {
    ambassador: {
      mcpBindings: [{ serverId: 'den', toolNames: ['get_task'] }],
    },
  });
  assert.equal(config.fixtureCredentialRef, 'credential-preserved');
}

async function assertLegacyConfig(instance) {
  const configRoot = join(stackRoot, 'instances', instance, 'config');
  const env = await readFile(join(configRoot, 'service.env'), 'utf8');
  assert.match(env, /^RUSTY_CREW_DATA_DIR=\/srv\/rusty-crew$/m);
  assert.match(
    env,
    /^RUSTY_CREW_MCP_BASE_URL=http:\/\/host\.docker\.internal:5199\/mcp$/m,
  );
  const config = JSON.parse(
    await readFile(join(configRoot, 'service.json'), 'utf8'),
  );
  assert.equal(config.profilesDir, '/srv/rusty-crew/config/profiles');
  assert.equal(config.skillsDir, '/srv/rusty-crew/config/skills');
}

async function assertStoppedContainer(container) {
  assert.equal(
    await readFile(join(stateRoot, `container-${container}`), 'utf8'),
    'stopped\n',
  );
}

async function assertMissing(path) {
  try {
    await lstat(path);
    assert.fail(`${path} should not exist`);
  } catch (error) {
    assert.equal(error.code, 'ENOENT');
  }
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  assert.equal(
    result.status,
    0,
    `${command} ${args.join(' ')} failed\n${result.stdout}\n${result.stderr}`,
  );
}

async function installFakeCommands() {
  await writeExecutable(
    'systemctl',
    `#!/usr/bin/env bash
set -euo pipefail
state="\${RUSTY_STACK_TEST_STATE:?}"
command="\${1:?}"
shift
case "\${command}" in
  daemon-reload) exit 0 ;;
  enable)
    for unit in "\$@"; do
      [[ "\${unit}" == "--now" ]] && continue
      instance="\${unit#rusty-crew-m5@}"; instance="\${instance%.service}"
      printf 'enabled\\n' >"\${state}/systemctl-enabled-\${instance}"
    done
    ;;
  restart)
    if [[ -f "\${state}/fail-restart-once" ]]; then
      rm -f "\${state}/fail-restart-once"
      exit 1
    fi
    for unit in "\$@"; do
      instance="\${unit#rusty-crew-m5@}"; instance="\${instance%.service}"
      printf 'active\\n' >"\${state}/systemctl-active-\${instance}"
    done
    ;;
  stop)
    for unit in "\$@"; do
      instance="\${unit#rusty-crew-m5@}"; instance="\${instance%.service}"
      rm -f "\${state}/systemctl-active-\${instance}"
    done
    ;;
  is-active)
    [[ "\${1:-}" == "--quiet" ]] && shift
    unit="\${1:?}"; instance="\${unit#rusty-crew-m5@}"; instance="\${instance%.service}"
    [[ -f "\${state}/systemctl-active-\${instance}" ]]
    ;;
  is-enabled)
    [[ "\${1:-}" == "--quiet" ]] && shift
    unit="\${1:?}"; instance="\${unit#rusty-crew-m5@}"; instance="\${instance%.service}"
    [[ -f "\${state}/systemctl-enabled-\${instance}" ]]
    ;;
  *) echo "unexpected fake systemctl command: \${command}" >&2; exit 2 ;;
esac
`,
  );

  await writeExecutable(
    'curl',
    `#!/usr/bin/env bash
set -euo pipefail
url="\${*: -1}"
case "\${url}" in
  http://127.0.0.1:9347/|http://127.0.0.1:9348/)
    printf '<html><head><title>Rusty View</title></head><body><rv-root></rv-root></body></html>'
    ;;
  http://127.0.0.1:9347/v1/admin/healthz|http://127.0.0.1:9348/v1/admin/healthz)
    printf '{"ok":true,"data":{"ok":true,"health":"ok"}}'
    ;;
esac
`,
  );

  await writeExecutable(
    'docker',
    `#!/usr/bin/env bash
set -euo pipefail
state="\${RUSTY_STACK_TEST_STATE:?}"
command="\${1:?}"
shift
case "\${command}" in
  build)
    count="\$(cat "\${state}/docker-build-count")"
    printf '%s\\n' "\$((count + 1))" >"\${state}/docker-build-count"
    ;;
  create) printf 'fixture-build-container\\n' ;;
  cp)
    source="\${1:?}"; target="\${2:?}"
    case "\${source}" in
      *:/opt/rusty-crew/.)
        mkdir -p "\${target}/ts/packages/service-host/src"
        printf 'export {};\\n' >"\${target}/ts/packages/service-host/src/start.ts"
        printf 'export {};\\n' >"\${target}/ts/packages/service-host/src/preflight.ts"
        ;;
      *:/opt/rusty-view/site/.)
        mkdir -p "\${target}"
        printf '<title>Rusty View</title><rv-root></rv-root>\\n' >"\${target}/index.html"
        ;;
      *:/usr/local/bin/node)
        cp "\$(command -v node)" "\${target}"
        ;;
      *:/usr/local/lib/node_modules/npm/.)
        mkdir -p "\${target}/bin"
        printf 'export {};\\n' >"\${target}/bin/npm-cli.js"
        printf 'export {};\\n' >"\${target}/bin/npx-cli.js"
        ;;
      *:/usr/local/lib/node_modules/tsx/.)
        mkdir -p "\${target}/dist"
        printf 'export {};\\n' >"\${target}/dist/cli.mjs"
        ;;
      *) echo "unexpected fake docker cp: \${source}" >&2; exit 2 ;;
    esac
    ;;
  inspect)
    format=""
    if [[ "\${1:-}" == "--format" ]]; then
      format="\${2:?}"
      shift 2
    fi
    container="\${1:?}"
    file="\${state}/container-\${container}"
    [[ -f "\${file}" ]] || exit 1
    if [[ "\${format}" == *State.Running* ]]; then
      [[ "\$(cat "\${file}")" == "running" ]] && printf 'true\\n' || printf 'false\\n'
    elif [[ "\${format}" == *Image* ]]; then
      printf 'sha256:fixture-%s\\n' "\${container}"
    fi
    ;;
  stop)
    [[ "\${1:-}" == "--time" ]] && shift 2
    container="\${1:?}"
    printf 'stopped\\n' >"\${state}/container-\${container}"
    ;;
  start)
    container="\${1:?}"
    printf 'running\\n' >"\${state}/container-\${container}"
    ;;
  rm)
    [[ "\${1:-}" == "--force" ]] && shift
    container="\${1:?}"
    if [[ "\${container}" != "fixture-build-container" ]]; then
      rm -f "\${state}/container-\${container}"
    fi
    ;;
  *) echo "unexpected fake docker command: \${command}" >&2; exit 2 ;;
esac
`,
  );
}

async function writeExecutable(name, content) {
  const path = join(fakeBin, name);
  await writeFile(path, content);
  await chmod(path, 0o755);
}
