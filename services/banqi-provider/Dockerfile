# Build ONLY the allowlisted staged context from engine:banqi-host:context.
# Both source and Linux release executable stay public; models are runtime-only.
FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d AS engine
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*
COPY fetch-release-asset.sh /fetch-release-asset.sh
RUN sh /fetch-release-asset.sh /engine banqi-engine

FROM node:22-bookworm-slim@sha256:5ec23b7c622b00547753bc6ffd78085dd868a68aeb41c8e0a1418f033e13d96d
ENV NODE_ENV=production PORT=8080
WORKDIR /opt/banqi
COPY --from=engine /engine/banqi-engine ./banqi-engine
COPY --chmod=0444 worker.mjs ./worker.mjs
COPY LICENSE ./LICENSE
COPY ENGINE-LICENSE ./ENGINE-LICENSE
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
CMD ["node", "--max-old-space-size=256", "/opt/banqi/worker.mjs"]
