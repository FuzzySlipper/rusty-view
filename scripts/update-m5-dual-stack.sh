#!/usr/bin/env bash
set -euo pipefail

stack_root="${RUSTY_STACK_ROOT:-/data/services/rusty-stack}"
repos_root="${stack_root}/repos"
crew_repo="${repos_root}/rusty-crew"
view_repo="${repos_root}/rusty-view"
crew_remote="${RUSTY_CREW_GIT_URL:-https://github.com/FuzzySlipper/rusty-crew.git}"
view_remote="${RUSTY_VIEW_GIT_URL:-https://github.com/FuzzySlipper/rusty-view.git}"
compose_file="${view_repo}/docker/m5/compose.yaml"
stack_env="${stack_root}/stack.env"
manifest_file="${stack_root}/deployed-revisions.json"
lock_file="${stack_root}/update.lock"
mode="${1:-update}"

log() {
  printf '[rusty-stack] %s\n' "$*"
}

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'Required command is unavailable: %s\n' "$1" >&2
    exit 1
  fi
}

require_clean_repo() {
  local repo="$1"
  local label="$2"
  local dirty
  dirty="$(git -C "${repo}" status --porcelain=v1 --untracked-files=all)"
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
    git clone --filter=blob:none "${remote}" "${repo}"
  fi
  require_clean_repo "${repo}" "${label}"
}

update_repo() {
  local repo="$1"
  local label="$2"
  log "Fast-forwarding ${label}..."
  git -C "${repo}" fetch --prune origin
  git -C "${repo}" merge --ff-only origin/main
  require_clean_repo "${repo}" "${label}"
}

write_instance_config() {
  local instance="$1"
  local root="${stack_root}/instances/${instance}"

  install -d -m 0755 \
    "${root}/config/profiles" \
    "${root}/config/skills" \
    "${root}/data/engine" \
    "${root}/run" \
    "${root}/logs" \
    "${root}/artifacts" \
    "${root}/backups" \
    "${root}/workspace"

  if [[ ! -f "${root}/config/service.env" ]]; then
    umask 077
    {
      printf 'RUSTY_CREW_DATA_DIR=/srv/rusty-crew\n'
      printf 'RUSTY_CREW_DEPLOYMENT_ROLE=production\n'
      printf 'RUSTY_CREW_CONFIG_DIR=/srv/rusty-crew/config\n'
      printf 'RUSTY_CREW_ENGINE_DATA_DIR=/srv/rusty-crew/data/engine\n'
      printf 'RUSTY_CREW_LOG_DIR=/srv/rusty-crew/logs\n'
      printf 'RUSTY_CREW_RUN_DIR=/srv/rusty-crew/run\n'
      printf 'RUSTY_CREW_ARTIFACT_DIR=/srv/rusty-crew/artifacts\n'
      printf 'RUSTY_CREW_BACKUP_DIR=/srv/rusty-crew/backups\n'
      printf 'RUSTY_CREW_STATIC_DIR=/opt/rusty-view/site\n'
      printf 'RUSTY_CREW_DEFAULT_WORKDIR=/workspace\n'
      printf 'RUSTY_CREW_ADMIN_HOST=0.0.0.0\n'
      printf 'RUSTY_CREW_ADMIN_PORT=9347\n'
      printf 'RUSTY_CREW_ADMIN_ALLOW_LAN=true\n'
      printf 'RUSTY_CREW_ADMIN_AUTH_MODE=none\n'
      printf 'RUSTY_CREW_STORAGE_BACKEND=sqlite\n'
      printf 'RUSTY_CREW_SQLITE_PATH=coordination.sqlite3\n'
      printf 'RUSTY_CREW_SQLITE_WAL=true\n'
      printf 'RUSTY_CREW_SQLITE_BUSY_TIMEOUT_MS=5000\n'
      printf 'RUSTY_CREW_SCHEDULER_TICK_INTERVAL_MS=1000\n'
      printf 'RUSTY_CREW_WAKE_DISPATCH_INTERVAL_MS=250\n'
      printf 'RUSTY_CREW_MCP_BASE_URL=http://host.docker.internal:5199/mcp\n'
      printf 'RUSTY_CREW_MCP_REQUEST_TIMEOUT_MS=30000\n'
    } >"${root}/config/service.env"
  fi

  if [[ ! -f "${root}/config/service.json" ]]; then
    umask 077
    {
      printf '{\n'
      printf '  "profilesDir": "/srv/rusty-crew/config/profiles",\n'
      printf '  "skillsDir": "/srv/rusty-crew/config/skills",\n'
      printf '  "wakeTimeout": { "mode": "disabled" },\n'
      printf '  "brains": [],\n'
      printf '  "sessions": []\n'
      printf '}\n'
    } >"${root}/config/service.json"
  fi
}

write_stack_env() {
  local image="$1"
  local crew_revision="$2"
  local view_revision="$3"
  local target
  target="$(mktemp "${stack_root}/stack.env.XXXXXX")"
  {
    printf 'RUSTY_STACK_ROOT=%s\n' "${stack_root}"
    printf 'RUSTY_STACK_IMAGE=%s\n' "${image}"
    printf 'RUSTY_CREW_REVISION=%s\n' "${crew_revision}"
    printf 'RUSTY_VIEW_REVISION=%s\n' "${view_revision}"
  } >"${target}"
  chmod 0644 "${target}"
  mv "${target}" "${stack_env}"
}

compose() {
  docker compose \
    --env-file "${stack_env}" \
    --file "${compose_file}" \
    --project-directory "${stack_root}" \
    "$@"
}

verify_container() {
  local service="$1"
  local port="$2"
  local expected_crew="$3"
  local expected_view="$4"
  local html
  local actual_crew
  local actual_view
  local mcp_health

  curl --fail --silent --show-error \
    "http://127.0.0.1:${port}/v1/admin/healthz" >/dev/null
  html="$(curl --fail --silent --show-error "http://127.0.0.1:${port}/")"
  if [[ "${html}" != *'<rv-root'* ]] ||
    [[ "${html}" != *'<title>Rusty View</title>'* ]]; then
    printf 'Rusty View HTML verification failed on port %s\n' "${port}" >&2
    return 1
  fi

  actual_crew="$(docker inspect --format \
    '{{ index .Config.Labels "io.rusty-stack.crew-revision" }}' \
    "rusty-${service}")"
  actual_view="$(docker inspect --format \
    '{{ index .Config.Labels "io.rusty-stack.view-revision" }}' \
    "rusty-${service}")"
  [[ "${actual_crew}" == "${expected_crew}" ]]
  [[ "${actual_view}" == "${expected_view}" ]]

  mcp_health="$(compose exec -T "${service}" node -e \
    "fetch('http://host.docker.internal:5199/health').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))")"
  [[ -n "${mcp_health}" ]]
}

write_manifest() {
  local image="$1"
  local crew_revision="$2"
  local view_revision="$3"
  local target
  target="$(mktemp "${stack_root}/deployed-revisions.json.XXXXXX")"
  {
    printf '{\n'
    printf '  "updatedAt": "%s",\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '  "image": "%s",\n' "${image}"
    printf '  "rustyCrewRevision": "%s",\n' "${crew_revision}"
    printf '  "rustyViewRevision": "%s",\n' "${view_revision}"
    printf '  "instances": {\n'
    printf '    "a": {"port": 9347, "root": "%s/instances/a"},\n' "${stack_root}"
    printf '    "b": {"port": 9348, "root": "%s/instances/b"}\n' "${stack_root}"
    printf '  }\n'
    printf '}\n'
  } >"${target}"
  chmod 0644 "${target}"
  mv "${target}" "${manifest_file}"
}

check_sqlite_isolation() {
  local sqlite_a="${stack_root}/instances/a/data/engine/coordination.sqlite3"
  local sqlite_b="${stack_root}/instances/b/data/engine/coordination.sqlite3"
  local identity_a
  local identity_b
  [[ -f "${sqlite_a}" ]]
  [[ -f "${sqlite_b}" ]]
  identity_a="$(stat -c '%d:%i' "${sqlite_a}")"
  identity_b="$(stat -c '%d:%i' "${sqlite_b}")"
  if [[ "${identity_a}" == "${identity_b}" ]]; then
    printf 'SQLite isolation failed: both instances resolve to %s\n' \
      "${identity_a}" >&2
    return 1
  fi
  log "SQLite identities: a=${identity_a} b=${identity_b}"
}

check_sources() {
  ensure_repo "${crew_repo}" "${crew_remote}" "Rusty Crew"
  ensure_repo "${view_repo}" "${view_remote}" "Rusty View"
}

main() {
  require_command git
  require_command docker
  require_command curl
  require_command flock
  install -d -m 0755 "${stack_root}" "${repos_root}"
  exec 9>"${lock_file}"
  flock -n 9 || {
    printf 'Another Rusty stack update is already running.\n' >&2
    exit 1
  }

  check_sources
  if [[ "${mode}" == "--check-sources" ]]; then
    log "Both source checkouts are clean."
    return
  fi
  if [[ "${mode}" != "update" ]]; then
    printf 'Usage: %s [--check-sources]\n' "$0" >&2
    exit 2
  fi

  update_repo "${crew_repo}" "Rusty Crew"
  update_repo "${view_repo}" "Rusty View"

  local crew_revision
  local view_revision
  local image
  crew_revision="$(git -C "${crew_repo}" rev-parse HEAD)"
  view_revision="$(git -C "${view_repo}" rev-parse HEAD)"
  image="rusty-crew-view:${crew_revision:0:12}-${view_revision:0:12}"

  log "Building ${image}..."
  docker build \
    --file "${view_repo}/docker/den-srv/Dockerfile" \
    --build-context "rusty_crew=${crew_repo}" \
    --build-arg "CREW_REVISION=${crew_revision}" \
    --build-arg "VIEW_REVISION=${view_revision}" \
    --tag "${image}" \
    "${view_repo}"

  write_instance_config a
  write_instance_config b

  local previous_env=""
  if [[ -f "${stack_env}" ]]; then
    previous_env="$(mktemp "${stack_root}/stack.env.rollback.XXXXXX")"
    cp -a "${stack_env}" "${previous_env}"
  fi
  write_stack_env "${image}" "${crew_revision}" "${view_revision}"

  rollback() {
    local exit_code=$?
    trap - ERR
    if [[ -n "${previous_env}" ]] && [[ -f "${previous_env}" ]]; then
      log "Activation failed; restoring the prior paired image."
      cp -a "${previous_env}" "${stack_env}"
      compose up --detach --remove-orphans --wait
    fi
    exit "${exit_code}"
  }
  trap rollback ERR

  log "Activating both instances..."
  compose up --detach --remove-orphans --wait
  verify_container crew-a 9347 "${crew_revision}" "${view_revision}"
  verify_container crew-b 9348 "${crew_revision}" "${view_revision}"
  check_sqlite_isolation
  write_manifest "${image}" "${crew_revision}" "${view_revision}"

  trap - ERR
  if [[ -n "${previous_env}" ]]; then
    rm -f -- "${previous_env}"
  fi
  log "Updated a=http://$(hostname -I | awk '{print $1}'):9347/"
  log "Updated b=http://$(hostname -I | awk '{print $1}'):9348/"
}

main "$@"
