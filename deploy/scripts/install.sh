#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-coursicota}"
APP_HOME="${APP_HOME:-/home/${APP_USER}}"
APP_NAME="carrefour-mcp"
SOURCE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
INSTALL_DIR="${INSTALL_DIR:-${APP_HOME}/apps/${APP_NAME}}"
REPO_URL="${REPO_URL:-}"
REPO_BRANCH="${REPO_BRANCH:-}"
ENV_DIR="${ENV_DIR:-${APP_HOME}/etc}"
DATA_DIR="${DATA_DIR:-${APP_HOME}/data/${APP_NAME}}"
SERVICE_FILE="/etc/systemd/system/${APP_NAME}.service"

require_root() {
  if [[ ${EUID} -ne 0 ]]; then
    echo "This installer must be run as root." >&2
    exit 1
  fi
}

ensure_user() {
  if ! id -u "${APP_USER}" >/dev/null 2>&1; then
    useradd --create-home --home-dir "${APP_HOME}" --shell /bin/bash "${APP_USER}"
  fi
}

ensure_prerequisites() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl git chromium xauth nodejs npm python3 build-essential pkg-config
}

ensure_pnpm() {
  if command -v pnpm >/dev/null 2>&1; then
    return
  fi

  if command -v corepack >/dev/null 2>&1; then
    corepack enable
    corepack prepare pnpm@10.20.0 --activate
    return
  fi

  npm install -g pnpm@10.20.0
}

detect_repo_defaults() {
  if [[ -z "${REPO_URL}" ]]; then
    REPO_URL="$(git -C "${SOURCE_DIR}" config --get remote.origin.url || true)"
  fi

  if [[ -z "${REPO_URL}" ]]; then
    REPO_URL="https://github.com/cbenz/carrefour-mcp"
  fi

  if [[ -z "${REPO_BRANCH}" ]]; then
    REPO_BRANCH="$(git -C "${SOURCE_DIR}" rev-parse --abbrev-ref HEAD || true)"
  fi

  if [[ -z "${REPO_BRANCH}" || "${REPO_BRANCH}" == "HEAD" ]]; then
    REPO_BRANCH="main"
  fi
}

clone_or_update_repository() {
  install -d -o "${APP_USER}" -g "${APP_USER}" "$(dirname "${INSTALL_DIR}")"

  if [[ ! -d "${INSTALL_DIR}/.git" ]]; then
    runuser -u "${APP_USER}" -- git clone --branch "${REPO_BRANCH}" "${REPO_URL}" "${INSTALL_DIR}"
  else
    runuser -u "${APP_USER}" -- git -C "${INSTALL_DIR}" fetch --prune origin
    runuser -u "${APP_USER}" -- git -C "${INSTALL_DIR}" checkout "${REPO_BRANCH}"
    runuser -u "${APP_USER}" -- git -C "${INSTALL_DIR}" pull --ff-only origin "${REPO_BRANCH}"
  fi

  chown -R "${APP_USER}:${APP_USER}" "${INSTALL_DIR}"
}

ensure_runtime_directories() {
  install -d -o "${APP_USER}" -g "${APP_USER}" "${ENV_DIR}" "${DATA_DIR}"

  if [[ ! -f "${ENV_DIR}/${APP_NAME}.env" ]]; then
    cat > "${ENV_DIR}/${APP_NAME}.env" <<EOF
MCP_TRANSPORT=http
PORT=3000
CARREFOUR_AUTH_STATE_PATH=${DATA_DIR}/auth-state.json
CARREFOUR_AUTH_CDP_URL=http://127.0.0.1:9222
EOF
    chown "${APP_USER}:${APP_USER}" "${ENV_DIR}/${APP_NAME}.env"
    chmod 0640 "${ENV_DIR}/${APP_NAME}.env"
  fi
}

install_service() {
  install -D -m 0644 "${INSTALL_DIR}/deploy/systemd/${APP_NAME}.service" "${SERVICE_FILE}"
}

install_browser_dependencies() {
  cd "${INSTALL_DIR}"
  pnpm exec playwright install-deps chromium
}

build_application() {
  runuser -u "${APP_USER}" -- bash -lc "cd '${INSTALL_DIR}' && env HOME='${APP_HOME}' PATH='${PATH}' pnpm install --frozen-lockfile"
  install_browser_dependencies
  runuser -u "${APP_USER}" -- bash -lc "cd '${INSTALL_DIR}' && env HOME='${APP_HOME}' PATH='${PATH}' npm run install:browsers"
  runuser -u "${APP_USER}" -- bash -lc "cd '${INSTALL_DIR}' && env HOME='${APP_HOME}' PATH='${PATH}' pnpm build"
}

main() {
  require_root
  ensure_prerequisites
  ensure_user
  ensure_pnpm
  detect_repo_defaults
  clone_or_update_repository
  ensure_runtime_directories
  install_service
  systemctl daemon-reload
  build_application
  systemctl enable --now "${APP_NAME}"
}

main "$@"
