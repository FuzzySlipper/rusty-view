#!/usr/bin/env bash
set -Eeuo pipefail

stack_root="${RUSTY_STACK_ROOT:-/data/services/rusty-stack}"
stack_user="${RUSTY_STACK_USER:-jb}"
stack_group="${RUSTY_STACK_GROUP:-${stack_user}}"
repos_root="${stack_root}/repos"
crew_repo="${repos_root}/rusty-crew"
view_repo="${repos_root}/rusty-view"
crew_remote="${RUSTY_CREW_GIT_URL:-https://github.com/FuzzySlipper/rusty-crew.git}"
view_remote="${RUSTY_VIEW_GIT_URL:-https://github.com/FuzzySlipper/rusty-view.git}"
releases_root="${stack_root}/releases"
current_link="${stack_root}/current"
manifest_file="${stack_root}/deployed-revisions.json"
retirement_file="${stack_root}/docker-retired.json"
lock_file="${stack_root}/update.lock"
unit_source="${view_repo}/deploy/m5/rusty-crew-m5@.service"
unit_target="${RUSTY_STACK_UNIT_TARGET:-/etc/systemd/system/rusty-crew-m5@.service}"
dockerfile="${view_repo}/docker/den-srv/Dockerfile"
mode="${1:-update}"
test_mode="${RUSTY_STACK_TEST_MODE:-0}"
built_release=""

log() {
  printf '[rusty-stack] %s\n' "$*"
}

fail() {
  printf '[rusty-stack] ERROR: %s\n' "$*" >&2
  return 1
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    fail "required command is unavailable: $1"
  fi
}

run_as_stack_user() {
  if [[ "${test_mode}" == "1" ]] || [[ "$(id -un)" == "${stack_user}" ]]; then
    "$@"
    return
  fi
  runuser -u "${stack_user}" -- "$@"
}

systemctl_stack() {
  if [[ "${test_mode}" == "1" ]]; then
    "${RUSTY_STACK_SYSTEMCTL:-systemctl}" "$@"
    return
  fi
  systemctl "$@"
}

docker_stack() {
  if [[ "${test_mode}" == "1" ]]; then
    "${RUSTY_STACK_DOCKER:-docker}" "$@"
    return
  fi
  run_as_stack_user docker "$@"
}

require_root() {
  if [[ "${test_mode}" != "1" ]] && [[ "$(id -u)" -ne 0 ]]; then
    fail "run this updater as root (normally: sudo update-rusty-stack)"
  fi
}

require_clean_repo() {
  local repo="$1"
  local label="$2"
  local dirty
  dirty="$(run_as_stack_user git -C "${repo}" status --porcelain=v1 --untracked-files=all)"
  if [[ -n "${dirty}" ]]; then
    printf '%s checkout is dirty; refusing an unreproducible update:\n%s\n' \
      "${label}" "${dirty}" >&2
    return 1
  fi
}

ensure_repo() {
  local repo="$1"
  local remote="$2"
  local label="$3"
  if [[ ! -d "${repo}/.git" ]]; then
    log "Cloning ${label}..."
    run_as_stack_user git clone --filter=blob:none "${remote}" "${repo}"
  fi
  require_clean_repo "${repo}" "${label}"
}

update_repo() {
  local repo="$1"
  local label="$2"
  log "Fast-forwarding ${label}..."
  run_as_stack_user git -C "${repo}" fetch --prune origin
  run_as_stack_user git -C "${repo}" merge --ff-only origin/main
  require_clean_repo "${repo}" "${label}"
}

set_env_value() {
  local file="$1"
  local key="$2"
  local value="$3"
  local target
  target="$(mktemp "${file}.XXXXXX")"
  awk -v key="${key}" -v value="${value}" '
    BEGIN { found = 0 }
    index($0, key "=") == 1 {
      print key "=" value
      found = 1
      next
    }
    { print }
    END {
      if (!found) {
        print key "=" value
      }
    }
  ' "${file}" >"${target}"
  chmod 0600 "${target}"
  mv "${target}" "${file}"
}

write_instance_config() {
  local instance="$1"
  local port="$2"
  local root="${stack_root}/instances/${instance}"
  local legacy_config="${root}/config"
  local native_config="${root}/native-config"
  local env_file="${native_config}/service.env"
  local json_file="${native_config}/service.json"

  install -d -m 0700 \
    "${legacy_config}" \
    "${legacy_config}/profiles" \
    "${legacy_config}/skills" \
    "${native_config}" \
    "${root}/data" \
    "${root}/data/engine"
  install -d -m 0755 \
    "${root}/run" \
    "${root}/logs" \
    "${root}/artifacts" \
    "${root}/backups" \
    "${root}/workspace"

  if [[ "${test_mode}" == "1" ]] &&
    [[ "${RUSTY_STACK_FAIL_CONFIG_INSTANCE:-}" == "${instance}" ]]; then
    fail "injected native config failure for instance ${instance}"
  fi

  if [[ ! -f "${env_file}" ]]; then
    if [[ -f "${legacy_config}/service.env" ]]; then
      install -m 0600 "${legacy_config}/service.env" "${env_file}"
    else
      install -m 0600 /dev/null "${env_file}"
    fi
  fi
  set_env_value "${env_file}" "RUSTY_CREW_DATA_DIR" "${root}"
  set_env_value "${env_file}" "RUSTY_CREW_DEPLOYMENT_ROLE" "production"
  set_env_value "${env_file}" "RUSTY_CREW_CONFIG_DIR" "${native_config}"
  set_env_value "${env_file}" "RUSTY_CREW_ENGINE_DATA_DIR" "${root}/data/engine"
  set_env_value "${env_file}" "RUSTY_CREW_LOG_DIR" "${root}/logs"
  set_env_value "${env_file}" "RUSTY_CREW_RUN_DIR" "${root}/run"
  set_env_value "${env_file}" "RUSTY_CREW_ARTIFACT_DIR" "${root}/artifacts"
  set_env_value "${env_file}" "RUSTY_CREW_BACKUP_DIR" "${root}/backups"
  set_env_value "${env_file}" "RUSTY_CREW_STATIC_DIR" "${current_link}/site"
  set_env_value "${env_file}" "RUSTY_CREW_DEFAULT_WORKDIR" "${root}/workspace"
  set_env_value "${env_file}" "RUSTY_CREW_ADMIN_HOST" "0.0.0.0"
  set_env_value "${env_file}" "RUSTY_CREW_ADMIN_PORT" "${port}"
  set_env_value "${env_file}" "RUSTY_CREW_ADMIN_ALLOW_LAN" "true"
  set_env_value "${env_file}" "RUSTY_CREW_ADMIN_AUTH_MODE" "none"
  set_env_value "${env_file}" "RUSTY_CREW_STORAGE_BACKEND" "sqlite"
  set_env_value "${env_file}" "RUSTY_CREW_SQLITE_PATH" "coordination.sqlite3"
  set_env_value "${env_file}" "RUSTY_CREW_SQLITE_WAL" "true"
  set_env_value "${env_file}" "RUSTY_CREW_SQLITE_BUSY_TIMEOUT_MS" "5000"
  set_env_value "${env_file}" "RUSTY_CREW_SCHEDULER_TICK_INTERVAL_MS" "1000"
  set_env_value "${env_file}" "RUSTY_CREW_WAKE_DISPATCH_INTERVAL_MS" "250"
  set_env_value "${env_file}" "RUSTY_CREW_MCP_BASE_URL" "http://127.0.0.1:5199/mcp"
  set_env_value "${env_file}" "RUSTY_CREW_MCP_REQUEST_TIMEOUT_MS" "30000"

  if [[ ! -f "${json_file}" ]]; then
    if [[ -f "${legacy_config}/service.json" ]]; then
      install -m 0600 "${legacy_config}/service.json" "${json_file}"
    else
      printf '{}\n' >"${json_file}"
      chmod 0600 "${json_file}"
    fi
  fi
  node - "${json_file}" "${root}" <<'NODE'
const fs = require("node:fs");
const [file, root] = process.argv.slice(2);
const config = JSON.parse(fs.readFileSync(file, "utf8"));
config.profilesDir = `${root}/config/profiles`;
config.skillsDir = `${root}/config/skills`;
config.wakeTimeout ??= { mode: "disabled" };
config.brains ??= [];
config.sessions ??= [];
const target = `${file}.tmp`;
fs.writeFileSync(target, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });
fs.renameSync(target, file);
NODE
}

sqlite_identity() {
  local instance="$1"
  stat -c '%d:%i' \
    "${stack_root}/instances/${instance}/data/engine/coordination.sqlite3"
}

docker_container_exists() {
  docker_stack inspect "$1" >/dev/null 2>&1
}

docker_container_running() {
  [[ "$(docker_stack inspect --format '{{.State.Running}}' "$1" 2>/dev/null || true)" == "true" ]]
}

stop_legacy_containers() {
  local container
  for container in rusty-crew-a rusty-crew-b; do
    if docker_container_running "${container}"; then
      log "Stopping legacy container ${container}..."
      docker_stack stop --time 30 "${container}" >/dev/null
    fi
  done
}

start_legacy_containers() {
  local container
  for container in rusty-crew-a rusty-crew-b; do
    if docker_container_exists "${container}"; then
      log "Restoring legacy container ${container}..."
      docker_stack start "${container}" >/dev/null
    fi
  done
}

write_runtime_wrappers() {
  local release="$1"
  cat >"${release}/bin/npm" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec "${root}/bin/node" "${root}/lib/node_modules/npm/bin/npm-cli.js" "$@"
EOF
  cat >"${release}/bin/npx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec "${root}/bin/node" "${root}/lib/node_modules/npm/bin/npx-cli.js" "$@"
EOF
  cat >"${release}/bin/tsx" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
exec "${root}/bin/node" "${root}/lib/node_modules/tsx/dist/cli.mjs" "$@"
EOF
  chmod 0755 "${release}/bin/node" \
    "${release}/bin/npm" \
    "${release}/bin/npx" \
    "${release}/bin/tsx"
}

build_release() {
  local crew_revision="$1"
  local view_revision="$2"
  local release_name="$3"
  local release="${releases_root}/${release_name}"
  local staging="${release}.staging"
  local image="rusty-crew-view-build:${crew_revision:0:12}-${view_revision:0:12}"
  local container_id=""

  rm -rf -- "${staging}"
  install -d -m 0755 \
    "${staging}/crew" \
    "${staging}/site" \
    "${staging}/bin" \
    "${staging}/lib/node_modules/npm" \
    "${staging}/lib/node_modules/tsx"
  chown -R "${stack_user}:${stack_group}" "${staging}"

  log "Building exact paired release ${release_name}..."
  docker_stack build \
    --file "${dockerfile}" \
    --build-context "rusty_crew=${crew_repo}" \
    --build-arg "CREW_REVISION=${crew_revision}" \
    --build-arg "VIEW_REVISION=${view_revision}" \
    --tag "${image}" \
    "${view_repo}"

  container_id="$(docker_stack create "${image}")"
  cleanup_build_container() {
    if [[ -n "${container_id}" ]]; then
      docker_stack rm --force "${container_id}" >/dev/null 2>&1 || true
    fi
  }
  trap cleanup_build_container EXIT

  docker_stack cp "${container_id}:/opt/rusty-crew/." "${staging}/crew/"
  docker_stack cp "${container_id}:/opt/rusty-view/site/." "${staging}/site/"
  docker_stack cp "${container_id}:/usr/local/bin/node" "${staging}/bin/node"
  docker_stack cp \
    "${container_id}:/usr/local/lib/node_modules/npm/." \
    "${staging}/lib/node_modules/npm/"
  docker_stack cp \
    "${container_id}:/usr/local/lib/node_modules/tsx/." \
    "${staging}/lib/node_modules/tsx/"
  cleanup_build_container
  container_id=""
  trap - EXIT

  write_runtime_wrappers "${staging}"
  cat >"${staging}/release.json" <<EOF
{
  "schemaVersion": 1,
  "deploymentMode": "host-native-systemd",
  "rustyCrewRevision": "${crew_revision}",
  "rustyViewRevision": "${view_revision}",
  "nodeVersion": "$("${staging}/bin/node" --version)",
  "builtAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
}
EOF
  chown -R "${stack_user}:${stack_group}" "${staging}"
  chmod -R u+rwX,go+rX "${staging}"
  mv "${staging}" "${release}"
  built_release="${release}"
}

install_unit() {
  install -m 0644 "${unit_source}" "${unit_target}"
  systemctl_stack daemon-reload
  systemctl_stack enable rusty-crew-m5@a.service rusty-crew-m5@b.service >/dev/null
}

switch_current_release() {
  local release="$1"
  local target="${stack_root}/current.next"
  ln -sfn "${release}" "${target}"
  mv -Tf "${target}" "${current_link}"
}

verify_instance() {
  local instance="$1"
  local port="$2"
  local expected_crew="$3"
  local expected_view="$4"
  local health
  local html

  systemctl_stack is-active --quiet "rusty-crew-m5@${instance}.service"
  systemctl_stack is-enabled --quiet "rusty-crew-m5@${instance}.service"
  health="$(
    curl --fail --silent --show-error \
      "http://127.0.0.1:${port}/v1/admin/healthz"
  )"
  jq -e \
    '.ok == true and .data.ok == true and .data.health == "ok"' \
    <<<"${health}" >/dev/null
  html="$(curl --fail --silent --show-error "http://127.0.0.1:${port}/")"
  [[ "${html}" == *'<rv-root'* ]]
  [[ "${html}" == *'<title>Rusty View</title>'* ]]
  [[ "$(jq -r '.rustyCrewRevision' "${current_link}/release.json")" == "${expected_crew}" ]]
  [[ "$(jq -r '.rustyViewRevision' "${current_link}/release.json")" == "${expected_view}" ]]
  grep -Fqx \
    "RUSTY_CREW_MCP_BASE_URL=http://127.0.0.1:5199/mcp" \
    "${stack_root}/instances/${instance}/native-config/service.env"
}

verify_stack() {
  local crew_revision="$1"
  local view_revision="$2"
  local identity_a="$3"
  local identity_b="$4"

  verify_instance a 9347 "${crew_revision}" "${view_revision}"
  verify_instance b 9348 "${crew_revision}" "${view_revision}"
  curl --fail --silent --show-error "http://127.0.0.1:5199/health" >/dev/null
  [[ "$(sqlite_identity a)" == "${identity_a}" ]]
  [[ "$(sqlite_identity b)" == "${identity_b}" ]]
  [[ "${identity_a}" != "${identity_b}" ]]
  if docker_container_running rusty-crew-a || docker_container_running rusty-crew-b; then
    fail "legacy Crew containers are still running"
  fi
}

write_manifest() {
  local release_name="$1"
  local crew_revision="$2"
  local view_revision="$3"
  local identity_a="$4"
  local identity_b="$5"
  local target
  target="$(mktemp "${stack_root}/deployed-revisions.json.XXXXXX")"
  cat >"${target}" <<EOF
{
  "schemaVersion": 2,
  "updatedAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "deploymentMode": "host-native-systemd",
  "serviceUser": "${stack_user}",
  "release": "${release_name}",
  "rustyCrewRevision": "${crew_revision}",
  "rustyViewRevision": "${view_revision}",
  "instances": {
    "a": {
      "port": 9347,
      "unit": "rusty-crew-m5@a.service",
      "root": "${stack_root}/instances/a",
      "sqliteIdentity": "${identity_a}"
    },
    "b": {
      "port": 9348,
      "unit": "rusty-crew-m5@b.service",
      "root": "${stack_root}/instances/b",
      "sqliteIdentity": "${identity_b}"
    }
  }
}
EOF
  chmod 0644 "${target}"
  mv "${target}" "${manifest_file}"
}

current_matches() {
  local crew_revision="$1"
  local view_revision="$2"
  [[ -L "${current_link}" ]] &&
    [[ -f "${current_link}/release.json" ]] &&
    [[ -f "${manifest_file}" ]] &&
    [[ "$(jq -r '.deploymentMode // ""' "${manifest_file}")" == "host-native-systemd" ]] &&
    [[ "$(jq -r '.rustyCrewRevision // ""' "${manifest_file}")" == "${crew_revision}" ]] &&
    [[ "$(jq -r '.rustyViewRevision // ""' "${manifest_file}")" == "${view_revision}" ]]
}

retire_docker() {
  local container
  local image_a=""
  local image_b=""
  local crew_revision
  local view_revision
  local identity_a
  local identity_b

  [[ -f "${manifest_file}" ]] || fail "no native deployment manifest exists"
  crew_revision="$(jq -r '.rustyCrewRevision' "${manifest_file}")"
  view_revision="$(jq -r '.rustyViewRevision' "${manifest_file}")"
  identity_a="$(jq -r '.instances.a.sqliteIdentity' "${manifest_file}")"
  identity_b="$(jq -r '.instances.b.sqliteIdentity' "${manifest_file}")"
  verify_stack \
    "${crew_revision}" "${view_revision}" "${identity_a}" "${identity_b}"

  if docker_container_running rusty-crew-a || docker_container_running rusty-crew-b; then
    fail "refusing Docker retirement while a legacy container is running"
  fi
  if docker_container_exists rusty-crew-a; then
    image_a="$(docker_stack inspect --format '{{.Image}}' rusty-crew-a)"
  fi
  if docker_container_exists rusty-crew-b; then
    image_b="$(docker_stack inspect --format '{{.Image}}' rusty-crew-b)"
  fi
  for container in rusty-crew-a rusty-crew-b; do
    if docker_container_exists "${container}"; then
      docker_stack rm "${container}" >/dev/null
    fi
  done
  cat >"${retirement_file}" <<EOF
{
  "retiredAt": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "containers": ["rusty-crew-a", "rusty-crew-b"],
  "preservedImageIds": ["${image_a}", "${image_b}"],
  "dataDeleted": false
}
EOF
  chmod 0644 "${retirement_file}"
  log "Retired legacy Crew containers; images and instance data were preserved."
}

main() {
  require_root
  require_command awk
  require_command curl
  require_command docker
  require_command flock
  require_command git
  require_command jq
  require_command node
  if [[ "${test_mode}" != "1" ]]; then
    require_command runuser
  fi

  install -d -m 0755 "${stack_root}" "${repos_root}" "${releases_root}"
  exec 9>"${lock_file}"
  flock -n 9 || fail "another Rusty stack update is already running"

  if [[ "${mode}" == "--retire-docker" ]]; then
    retire_docker
    return
  fi
  if [[ "${mode}" == "--verify" ]]; then
    [[ -f "${manifest_file}" ]] || fail "no deployment manifest exists"
    verify_stack \
      "$(jq -r '.rustyCrewRevision' "${manifest_file}")" \
      "$(jq -r '.rustyViewRevision' "${manifest_file}")" \
      "$(jq -r '.instances.a.sqliteIdentity' "${manifest_file}")" \
      "$(jq -r '.instances.b.sqliteIdentity' "${manifest_file}")"
    log "Both native instances passed verification."
    return
  fi

  ensure_repo "${crew_repo}" "${crew_remote}" "Rusty Crew"
  ensure_repo "${view_repo}" "${view_remote}" "Rusty View"
  if [[ "${mode}" == "--check-sources" ]]; then
    log "Both source checkouts are clean."
    return
  fi
  [[ "${mode}" == "update" ]] ||
    fail "usage: $0 [--check-sources|--verify|--retire-docker]"

  update_repo "${crew_repo}" "Rusty Crew"
  update_repo "${view_repo}" "Rusty View"

  local crew_revision
  local view_revision
  local release_name
  local release
  local previous_release=""
  local had_native_units=false
  local had_container_a=false
  local had_container_b=false
  local identity_a
  local identity_b
  local native_config_backup=""
  local native_config_snapshot_ready=false
  declare -A native_config_existed=([a]=false [b]=false)

  crew_revision="$(run_as_stack_user git -C "${crew_repo}" rev-parse HEAD)"
  view_revision="$(run_as_stack_user git -C "${view_repo}" rev-parse HEAD)"
  release_name="$(date -u +%Y%m%dT%H%M%SZ)-${crew_revision:0:12}-${view_revision:0:12}"

  if [[ -L "${current_link}" ]]; then
    previous_release="$(readlink -f "${current_link}")"
  fi
  if systemctl_stack is-active --quiet rusty-crew-m5@a.service &&
    systemctl_stack is-active --quiet rusty-crew-m5@b.service; then
    had_native_units=true
  fi
  if docker_container_running rusty-crew-a; then
    had_container_a=true
  fi
  if docker_container_running rusty-crew-b; then
    had_container_b=true
  fi

  if current_matches "${crew_revision}" "${view_revision}"; then
    identity_a="$(sqlite_identity a)"
    identity_b="$(sqlite_identity b)"
    install_unit
    systemctl_stack restart rusty-crew-m5@a.service rusty-crew-m5@b.service
    verify_stack \
      "${crew_revision}" "${view_revision}" "${identity_a}" "${identity_b}"
    log "No source change; exact native release remains healthy."
    return
  fi

  build_release "${crew_revision}" "${view_revision}" "${release_name}"
  release="${built_release}"

  snapshot_native_config() {
    local instance
    native_config_backup="$(mktemp -d "${stack_root}/native-config-backup.XXXXXX")"
    for instance in a b; do
      if [[ -d "${stack_root}/instances/${instance}/native-config" ]]; then
        cp -a \
          "${stack_root}/instances/${instance}/native-config" \
          "${native_config_backup}/${instance}"
        native_config_existed["${instance}"]=true
      fi
    done
    native_config_snapshot_ready=true
  }

  restore_native_config() {
    local instance
    local target
    for instance in a b; do
      target="${stack_root}/instances/${instance}/native-config"
      rm -rf -- "${target}"
      if [[ "${native_config_existed[${instance}]}" == "true" ]]; then
        cp -a "${native_config_backup}/${instance}" "${target}"
      fi
    done
  }

  cleanup_native_config_backup() {
    if [[ -n "${native_config_backup}" ]]; then
      rm -rf -- "${native_config_backup}"
      native_config_backup=""
    fi
  }

  rollback() {
    local exit_code=$?
    trap - ERR
    log "Native activation failed; restoring the previous runtime."
    systemctl_stack stop \
      rusty-crew-m5@a.service rusty-crew-m5@b.service >/dev/null 2>&1 || true
    if [[ "${native_config_snapshot_ready}" == "true" ]]; then
      restore_native_config
    fi
    if [[ -n "${native_config_backup}" ]]; then
      cleanup_native_config_backup
    fi
    if [[ -n "${previous_release}" ]]; then
      switch_current_release "${previous_release}"
    elif [[ -L "${current_link}" ]]; then
      unlink "${current_link}"
    fi
    if [[ "${had_native_units}" == "true" ]] && [[ -n "${previous_release}" ]]; then
      systemctl_stack restart \
        rusty-crew-m5@a.service rusty-crew-m5@b.service >/dev/null 2>&1 || true
    else
      if [[ "${had_container_a}" == "true" ]] ||
        [[ "${had_container_b}" == "true" ]]; then
        start_legacy_containers
      fi
    fi
    exit "${exit_code}"
  }
  trap rollback ERR

  stop_legacy_containers
  if systemctl_stack is-active --quiet rusty-crew-m5@a.service ||
    systemctl_stack is-active --quiet rusty-crew-m5@b.service; then
    systemctl_stack stop rusty-crew-m5@a.service rusty-crew-m5@b.service
  fi

  snapshot_native_config
  chown -R "${stack_user}:${stack_group}" "${stack_root}/instances"
  write_instance_config a 9347
  write_instance_config b 9348
  chown -R "${stack_user}:${stack_group}" "${stack_root}/instances"
  identity_a="$(sqlite_identity a)"
  identity_b="$(sqlite_identity b)"
  [[ "${identity_a}" != "${identity_b}" ]] ||
    fail "SQLite isolation failed: both instances resolve to ${identity_a}"

  install_unit
  switch_current_release "${release}"
  systemctl_stack restart rusty-crew-m5@a.service rusty-crew-m5@b.service
  verify_stack \
    "${crew_revision}" "${view_revision}" "${identity_a}" "${identity_b}"
  write_manifest \
    "${release_name}" "${crew_revision}" "${view_revision}" \
    "${identity_a}" "${identity_b}"
  cleanup_native_config_backup
  trap - ERR

  log "Updated native A: http://$(hostname -I | awk '{print $1}'):9347/"
  log "Updated native B: http://$(hostname -I | awk '{print $1}'):9348/"
  if docker_container_exists rusty-crew-a || docker_container_exists rusty-crew-b; then
    log "Legacy containers remain stopped for rollback; retire them after reboot acceptance with --retire-docker."
  fi
}

main "$@"
