ARG BASE_IMAGE=tb-config-mate-base:latest
FROM ${BASE_IMAGE}

WORKDIR /opt/tb-config-mate

COPY package.json tb-config-src.js config-meta.js index.html ./
COPY assets ./assets
COPY src ./src
COPY meta ./meta

ENV NODE_ENV=production \
    PORT=3300 \
    NO_BROWSER=1

EXPOSE 3300

CMD ["node", "/opt/tb-config-mate/tb-config-src.js"]
