FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
ARG JDTLS_BUILD=1.61.0-202608271509
ARG JDTLS_SHA256=edbbcb7b7b83b8fb0124544a2c1b14565424ef6b6bd102b6c8c75ea4580bdd14

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates clangd curl g++ gcc nodejs npm openjdk-21-jdk-headless python3 tini \
    && rm -rf /var/lib/apt/lists/*

RUN curl -fsSL "https://download.eclipse.org/jdtls/snapshots/jdt-language-server-${JDTLS_BUILD}.tar.gz" -o /tmp/jdtls.tar.gz \
    && echo "${JDTLS_SHA256}  /tmp/jdtls.tar.gz" | sha256sum -c - \
    && mkdir -p /opt/jdtls \
    && tar -xzf /tmp/jdtls.tar.gz -C /opt/jdtls \
    && rm /tmp/jdtls.tar.gz

RUN useradd --create-home --uid 10001 codearena
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY src ./src
USER codearena

ENV HOST=0.0.0.0 PORT=8000 PYTHON_BIN=python3 JDTLS_BIN=/opt/jdtls/bin/jdtls
EXPOSE 8000
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
