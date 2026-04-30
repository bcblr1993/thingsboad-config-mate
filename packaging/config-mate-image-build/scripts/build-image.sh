#!/usr/bin/env sh
set -eu

IMAGE_NAME="${IMAGE_NAME:-tb-config-mate:latest}"
BASE_IMAGE_NAME="${BASE_IMAGE_NAME:-tb-config-mate-base:latest}"
PLATFORM_ARG=""

if [ "${PLATFORM:-}" != "" ]; then
  PLATFORM_ARG="--platform ${PLATFORM}"
fi

if ! docker image inspect "${BASE_IMAGE_NAME}" >/dev/null 2>&1; then
  echo "未找到基础镜像: ${BASE_IMAGE_NAME}"
  echo "请先执行: ./build-base.sh"
  exit 1
fi

docker build ${PLATFORM_ARG} --build-arg BASE_IMAGE="${BASE_IMAGE_NAME}" -t "${IMAGE_NAME}" .

echo "镜像构建完成: ${IMAGE_NAME}"
