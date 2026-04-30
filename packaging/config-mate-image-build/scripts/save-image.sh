#!/usr/bin/env sh
set -eu

IMAGE_NAME="${IMAGE_NAME:-tb-config-mate:latest}"
OUTPUT="${OUTPUT:-tb-config-mate_latest.tar.gz}"

docker save "${IMAGE_NAME}" | gzip > "${OUTPUT}"

echo "离线镜像包已生成: ${OUTPUT}"
