#!/usr/bin/env bash
# Build Rusty View plus a reproducible Rusty Crew runtime image, then deploy an
# isolated Compose instance to den-srv. The default destination is
# /data/docker/rusty-eva; override RUSTY_VIEW_REMOTE_* variables when needed.
# Usage: ./scripts/deploy-den-srv.sh
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
crew_repo="${RUSTY_CREW_REPO:-/home/dev/rusty-crew}"
remote_host="${RUSTY_VIEW_REMOTE_HOST:-den-srv}"
remote_root="${RUSTY_VIEW_REMOTE_ROOT:-/data/docker/rusty-eva}"
remote_docker_host="${RUSTY_VIEW_REMOTE_DOCKER_HOST:-unix:///data/services/docker-rt/run/docker.sock}"
remote_port_start="${RUSTY_VIEW_REMOTE_PORT_START:-9347}"
remote_port_end="${RUSTY_VIEW_REMOTE_PORT_END:-9399}"
remote_port="${RUSTY_VIEW_REMOTE_PORT:-}"
ssh_config="${RUSTY_VIEW_SSH_CONFIG:-/home/agent/.ssh/config}"
image_repository="${RUSTY_VIEW_REMOTE_IMAGE_REPOSITORY:-rusty-view-crew}"
remote_public_host="${RUSTY_VIEW_REMOTE_PUBLIC_HOST:-}"

if [[ ! -d "${crew_repo}/.git" ]]; then
  echo "Rusty Crew checkout not found at ${crew_repo}" >&2
  exit 1
fi
if [[ ! "${remote_root}" =~ ^/data/docker/[^/]+$ ]]; then
  echo "Remote root must be one direct child of /data/docker: ${remote_root}" >&2
  exit 1
fi
if [[ ! "${remote_host}" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Invalid SSH host alias: ${remote_host}" >&2
  exit 1
fi
if [[ ! "${remote_docker_host}" =~ ^unix:///[a-zA-Z0-9._/-]+$ ]]; then
  echo "Invalid remote Docker socket URI: ${remote_docker_host}" >&2
  exit 1
fi
if [[ ! "${image_repository}" =~ ^[a-zA-Z0-9._/-]+$ ]]; then
  echo "Invalid image repository: ${image_repository}" >&2
  exit 1
fi
if [[ -z "${remote_public_host}" ]]; then
  remote_public_host="$(ssh -T -F "${ssh_config}" -G "${remote_host}" |
    awk '$1 == "hostname" { print $2; exit }')"
fi
if [[ ! "${remote_public_host}" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Invalid public host: ${remote_public_host}" >&2
  exit 1
fi
if ! git -C "${crew_repo}" diff --quiet --ignore-submodules -- || \
   ! git -C "${crew_repo}" diff --cached --quiet --ignore-submodules --; then
  echo "Rusty Crew checkout is dirty; commit or stash it before building a reproducible image." >&2
  exit 1
fi

ssh_command=(ssh -F "${ssh_config}" -o BatchMode=yes "${remote_host}")
scp_command=(scp -F "${ssh_config}")
local_staging="$(mktemp -d)"
remote_staging=""

cleanup() {
  rm -rf -- "${local_staging}"
  if [[ "${remote_staging}" == /tmp/rusty-eva-deploy.* ]]; then
    "${ssh_command[@]}" "sudo -n rm -rf -- '${remote_staging}'" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

echo "Building Rusty View..."
(
  cd "${repo_root}"
  pnpm exec nx build rusty-view
  node tools/fix-package-esm-specifiers.mjs --write
)

crew_revision="$(git -C "${crew_repo}" rev-parse HEAD)"
view_revision="$(git -C "${repo_root}" rev-parse HEAD)"
recipe_revision="$(sha256sum "${repo_root}/docker/den-srv/Dockerfile" | cut -c1-12)"
image="${image_repository}:${crew_revision:0:12}-${recipe_revision}"

remote_image_exists() {
  "${ssh_command[@]}" \
    "sudo -n env DOCKER_HOST='${remote_docker_host}' docker image inspect '${image}'" \
    >/dev/null 2>&1
}

if ! remote_image_exists; then
  if ! docker image inspect "${image}" >/dev/null 2>&1; then
    echo "Building Crew runtime image ${image}..."
    crew_context="${local_staging}/rusty-crew"
    install -d "${crew_context}"
    git -C "${crew_repo}" archive --format=tar HEAD | tar -xf - -C "${crew_context}"
    docker buildx build \
      --load \
      --network host \
      --build-context "rusty_crew=${crew_context}" \
      --build-arg "CREW_REVISION=${crew_revision}" \
      --build-arg "VIEW_REVISION=${view_revision}" \
      --tag "${image}" \
      --file "${repo_root}/docker/den-srv/Dockerfile" \
      "${repo_root}"
  fi

  echo "Transferring ${image} to ${remote_host}..."
  docker save "${image}" | gzip -1 |
    "${ssh_command[@]}" \
      "gzip -d | sudo -n env DOCKER_HOST='${remote_docker_host}' docker load >/dev/null"
fi

remote_staging="$("${ssh_command[@]}" 'mktemp -d /tmp/rusty-eva-deploy.XXXXXX')"
if [[ ! "${remote_staging}" == /tmp/rusty-eva-deploy.* ]]; then
  echo "Unexpected remote staging path: ${remote_staging}" >&2
  exit 1
fi

"${ssh_command[@]}" "install -d '${remote_staging}/site'"
tar -C "${repo_root}/dist/apps/rusty-view/browser" -cf - . |
  "${ssh_command[@]}" "tar -xf - -C '${remote_staging}/site'"
"${scp_command[@]}" \
  "${repo_root}/docker/den-srv/compose.yaml" \
  "${repo_root}/docker/den-srv/service.env" \
  "${repo_root}/docker/den-srv/service.json" \
  "${repo_root}/scripts/install-remote-rusty-view.sh" \
  "${remote_host}:${remote_staging}/"

install_command=(
  sudo -n env
  "DOCKER_HOST=${remote_docker_host}"
  "RUSTY_EVA_DEPLOYMENT_ROOT=${remote_root}"
  "RUSTY_EVA_STAGING_ROOT=${remote_staging}"
  "RUSTY_EVA_IMAGE=${image}"
  "RUSTY_EVA_PUBLIC_HOST=${remote_public_host}"
  "RUSTY_EVA_PORT_START=${remote_port_start}"
  "RUSTY_EVA_PORT_END=${remote_port_end}"
)
if [[ -n "${remote_port}" ]]; then
  install_command+=("RUSTY_EVA_PORT=${remote_port}")
fi
install_command+=(bash "${remote_staging}/install-remote-rusty-view.sh")

printf -v quoted_install_command '%q ' "${install_command[@]}"
"${ssh_command[@]}" "${quoted_install_command}"
