#!/usr/bin/env bash
set -euo pipefail

deployment_root="${RUSTY_EVA_DEPLOYMENT_ROOT:?RUSTY_EVA_DEPLOYMENT_ROOT is required}"
staging_root="${RUSTY_EVA_STAGING_ROOT:?RUSTY_EVA_STAGING_ROOT is required}"
image="${RUSTY_EVA_IMAGE:?RUSTY_EVA_IMAGE is required}"
port_start="${RUSTY_EVA_PORT_START:-9347}"
port_end="${RUSTY_EVA_PORT_END:-9399}"
requested_port="${RUSTY_EVA_PORT:-}"
docker_host="${DOCKER_HOST:?DOCKER_HOST is required}"
public_host="${RUSTY_EVA_PUBLIC_HOST:-}"

if [[ ! "${deployment_root}" =~ ^/data/docker/[^/]+$ ]]; then
  echo "Deployment root must be one direct child of /data/docker: ${deployment_root}" >&2
  exit 1
fi
if [[ ! -d "${staging_root}/site" ]] || [[ ! -f "${staging_root}/compose.yaml" ]]; then
  echo "Incomplete deployment staging directory: ${staging_root}" >&2
  exit 1
fi
if [[ ! "${image}" =~ ^[a-zA-Z0-9._:/-]+$ ]]; then
  echo "Invalid Docker image reference: ${image}" >&2
  exit 1
fi
if [[ ! "${docker_host}" =~ ^unix:///[a-zA-Z0-9._/-]+$ ]]; then
  echo "Invalid Docker socket URI: ${docker_host}" >&2
  exit 1
fi
if [[ ! "${public_host}" =~ ^[a-zA-Z0-9._-]+$ ]]; then
  echo "Invalid public host: ${public_host}" >&2
  exit 1
fi
if [[ ! "${port_start}" =~ ^[0-9]+$ ]] || [[ ! "${port_end}" =~ ^[0-9]+$ ]]; then
  echo "Port range must be numeric." >&2
  exit 1
fi
if (( port_start < 1024 || port_end > 65535 || port_start > port_end )); then
  echo "Invalid unprivileged port range: ${port_start}-${port_end}" >&2
  exit 1
fi

docker=(docker)
lock_file="/run/lock/rusty-eva-deploy.lock"
exec 9>"${lock_file}"
flock 9

port_is_reserved() {
  local candidate="$1"
  if ss -H -ltn | awk -v candidate="${candidate}" '
    {
      count = split($4, address, ":")
      if (address[count] == candidate) found = 1
    }
    END { exit(found ? 0 : 1) }
  '; then
    return 0
  fi

  "${docker[@]}" ps -a --format '{{.Ports}}' |
    grep -Eq "(^|[ ,])([^, ]*:)?${candidate}->"
}

port_is_owned_by_deployment() {
  local candidate="$1"
  "${docker[@]}" ps -a \
    --filter label=com.docker.compose.project=rusty-eva \
    --filter label=com.docker.compose.service=rusty-view \
    --format '{{.Ports}}' |
    grep -Eq "(^|[ ,])([^, ]*:)?${candidate}->"
}

validate_port() {
  local candidate="$1"
  if [[ ! "${candidate}" =~ ^[0-9]+$ ]] || (( candidate < 1024 || candidate > 65535 )); then
    echo "Invalid deployment port: ${candidate}" >&2
    exit 1
  fi
}

existing_port=""
if [[ -f "${deployment_root}/.env" ]]; then
  existing_port="$(sed -n 's/^RUSTY_EVA_PORT=//p' "${deployment_root}/.env" | tail -1)"
fi

if [[ -n "${requested_port}" ]]; then
  selected_port="${requested_port}"
elif [[ -n "${existing_port}" ]]; then
  selected_port="${existing_port}"
else
  selected_port=""
  for ((candidate = port_start; candidate <= port_end; candidate += 1)); do
    if ! port_is_reserved "${candidate}"; then
      selected_port="${candidate}"
      break
    fi
  done
  if [[ -z "${selected_port}" ]]; then
    echo "No free port found in ${port_start}-${port_end}." >&2
    exit 1
  fi
fi
validate_port "${selected_port}"

if port_is_reserved "${selected_port}"; then
  if [[ "${selected_port}" != "${existing_port}" ]] ||
    ! port_is_owned_by_deployment "${selected_port}"; then
    echo "Requested port ${selected_port} is already listening or reserved by Docker." >&2
    exit 1
  fi
fi

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
backup_root="${deployment_root}/backups/deployment-${timestamp}"
install -d "${deployment_root}" "${backup_root}"

for path in compose.yaml .env; do
  if [[ -f "${deployment_root}/${path}" ]]; then
    cp -a "${deployment_root}/${path}" "${backup_root}/${path}"
  fi
done
if [[ -d "${deployment_root}/site" ]]; then
  mv "${deployment_root}/site" "${backup_root}/site"
fi

install -d \
  "${deployment_root}/site" \
  "${deployment_root}/config/profiles" \
  "${deployment_root}/config/skills" \
  "${deployment_root}/data/engine" \
  "${deployment_root}/run" \
  "${deployment_root}/logs" \
  "${deployment_root}/artifacts" \
  "${deployment_root}/backups" \
  "${deployment_root}/workspace"

cp -a "${staging_root}/site/." "${deployment_root}/site/"
install -m 0644 "${staging_root}/compose.yaml" "${deployment_root}/compose.yaml"
if [[ ! -f "${deployment_root}/config/service.env" ]]; then
  install -m 0640 "${staging_root}/service.env" "${deployment_root}/config/service.env"
fi
if [[ ! -f "${deployment_root}/config/service.json" ]]; then
  install -m 0640 "${staging_root}/service.json" "${deployment_root}/config/service.json"
fi

env_file="$(mktemp "${deployment_root}/.env.XXXXXX")"
{
  printf 'RUSTY_EVA_IMAGE=%s\n' "${image}"
  printf 'RUSTY_EVA_PORT=%s\n' "${selected_port}"
} >"${env_file}"
chmod 0640 "${env_file}"
mv "${env_file}" "${deployment_root}/.env"

docker_socket="${docker_host#unix://}"
runtime_owner="$(stat -c '%u:%g' "${docker_socket}")"
chown -R "${runtime_owner}" \
  "${deployment_root}/config" \
  "${deployment_root}/data" \
  "${deployment_root}/run" \
  "${deployment_root}/logs" \
  "${deployment_root}/artifacts" \
  "${deployment_root}/backups" \
  "${deployment_root}/workspace"
chmod 0755 "${deployment_root}" "${deployment_root}/site"

compose=(
  "${docker[@]}" compose
  --file "${deployment_root}/compose.yaml"
  --project-directory "${deployment_root}"
)
"${compose[@]}" up --detach --force-recreate --wait rusty-view

health_url="http://127.0.0.1:${selected_port}/v1/admin/healthz"
site_url="http://127.0.0.1:${selected_port}/"
curl --fail --silent --show-error "${health_url}" >/dev/null
index_html="$(curl --fail --silent --show-error "${site_url}")"
if [[ "${index_html}" != *'<rv-root'* ]] || [[ "${index_html}" != *'<title>Rusty View</title>'* ]]; then
  echo "Rusty View HTML verification failed at ${site_url}" >&2
  exit 1
fi

echo "RUSTY_EVA_PORT=${selected_port}"
echo "RUSTY_EVA_URL=http://${public_host}:${selected_port}/"
echo "RUSTY_EVA_ROOT=${deployment_root}"
echo "RUSTY_EVA_IMAGE=${image}"
