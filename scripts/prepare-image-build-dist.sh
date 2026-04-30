#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${ROOT_DIR}/dist/config-mate-image-build"
TEMPLATE_DIR="${ROOT_DIR}/packaging/config-mate-image-build"

rm -rf "${OUT_DIR}"
mkdir -p "${OUT_DIR}"

copy_path() {
  local source="$1"
  local target="$2"

  mkdir -p "$(dirname "${target}")"
  cp -R "${source}" "${target}"
}

copy_path "${ROOT_DIR}/Dockerfile" "${OUT_DIR}/Dockerfile"
copy_path "${ROOT_DIR}/Dockerfile.base" "${OUT_DIR}/Dockerfile.base"
copy_path "${ROOT_DIR}/package.json" "${OUT_DIR}/package.json"
copy_path "${ROOT_DIR}/package-lock.json" "${OUT_DIR}/package-lock.json"
copy_path "${ROOT_DIR}/tb-config-src.js" "${OUT_DIR}/tb-config-src.js"
copy_path "${ROOT_DIR}/config-meta.js" "${OUT_DIR}/config-meta.js"
copy_path "${ROOT_DIR}/index.html" "${OUT_DIR}/index.html"
copy_path "${ROOT_DIR}/.dockerignore" "${OUT_DIR}/.dockerignore"
copy_path "${ROOT_DIR}/assets" "${OUT_DIR}/assets"
copy_path "${ROOT_DIR}/src" "${OUT_DIR}/src"
copy_path "${ROOT_DIR}/meta" "${OUT_DIR}/meta"

copy_path "${TEMPLATE_DIR}/README.md" "${OUT_DIR}/README.md"
copy_path "${TEMPLATE_DIR}/deploy" "${OUT_DIR}/deploy"
copy_path "${TEMPLATE_DIR}/scripts/build-base.sh" "${OUT_DIR}/build-base.sh"
copy_path "${TEMPLATE_DIR}/scripts/build-image.sh" "${OUT_DIR}/build-image.sh"
copy_path "${TEMPLATE_DIR}/scripts/build-all.sh" "${OUT_DIR}/build-all.sh"
copy_path "${TEMPLATE_DIR}/scripts/save-image.sh" "${OUT_DIR}/save-image.sh"

chmod +x "${OUT_DIR}/build-base.sh" "${OUT_DIR}/build-image.sh" "${OUT_DIR}/build-all.sh" "${OUT_DIR}/save-image.sh"

tar -czf "${ROOT_DIR}/dist/config-mate-image-build.tar.gz" -C "${ROOT_DIR}/dist" config-mate-image-build

echo "Prepared ${OUT_DIR}"
echo "Prepared ${ROOT_DIR}/dist/config-mate-image-build.tar.gz"
