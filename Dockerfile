FROM node:18-bookworm-slim

ARG DOCKER_CLI_VERSION=27.5.1
ARG DOCKER_COMPOSE_VERSION=2.32.4
ARG TARGETARCH

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl tar \
    && rm -rf /var/lib/apt/lists/* \
    && case "${TARGETARCH:-amd64}" in amd64) DOCKER_ARCH="x86_64"; COMPOSE_ARCH="x86_64" ;; arm64) DOCKER_ARCH="aarch64"; COMPOSE_ARCH="aarch64" ;; *) echo "Unsupported arch: ${TARGETARCH}" && exit 1 ;; esac \
    && curl -fsSL "https://download.docker.com/linux/static/stable/${DOCKER_ARCH}/docker-${DOCKER_CLI_VERSION}.tgz" -o /tmp/docker.tgz \
    && tar -xzf /tmp/docker.tgz -C /tmp \
    && mv /tmp/docker/docker /usr/local/bin/docker \
    && rm -rf /tmp/docker /tmp/docker.tgz \
    && mkdir -p /usr/local/lib/docker/cli-plugins \
    && curl -fsSL "https://github.com/docker/compose/releases/download/v${DOCKER_COMPOSE_VERSION}/docker-compose-linux-${COMPOSE_ARCH}" -o /usr/local/lib/docker/cli-plugins/docker-compose \
    && chmod +x /usr/local/bin/docker /usr/local/lib/docker/cli-plugins/docker-compose

WORKDIR /opt/tb-config-mate

COPY package*.json ./
RUN npm ci --omit=dev

COPY tb-config-src.js config-meta.js index.html ./
COPY meta ./meta

ENV NODE_ENV=production \
    PORT=3300 \
    NO_BROWSER=1

EXPOSE 3300

CMD ["node", "/opt/tb-config-mate/tb-config-src.js"]
