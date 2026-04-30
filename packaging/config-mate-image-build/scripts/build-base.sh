#!/usr/bin/env sh
set -eu

BASE_IMAGE_NAME="${BASE_IMAGE_NAME:-tb-config-mate-base:latest}"
PLATFORM_ARG=""

if [ "${PLATFORM:-}" != "" ]; then
  PLATFORM_ARG="--platform ${PLATFORM}"
fi

docker build ${PLATFORM_ARG} ${EXTRA_BUILD_ARGS:-} -f Dockerfile.base -t "${BASE_IMAGE_NAME}" .

echo "基础镜像构建完成: ${BASE_IMAGE_NAME}"
