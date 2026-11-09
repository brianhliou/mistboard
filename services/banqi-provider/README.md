# Temporary private Banqi host

This package runs the pinned MistyBanqi Linux x86-64 release and its pinned NNUE
model behind an authenticated HTTP listener. It is independent of the old
`engine-worker`, Python, the web runtime and Postgres. It adds no public opponent
or default routing. The [provider guide](../../docs/banqi-engine-providers.md)
describes the public-information contract and internal test-room route.

The distributable image contains **no model bytes or credentials**. Its executable
comes from the checked `banqi-engine` entry in
[fetch-release-asset.sh](../../scripts/fetch-release-asset.sh). Model repository,
release, filename and SHA are taken from the existing `banqi-net` entry in
[fetch-private-net.sh](../../scripts/fetch-private-net.sh) at bundle time. This
loader fails startup on missing credentials, invalid metadata, bad bytes or hash
mismatch; it does not inherit that older script's soft-failure behavior.

The main source is AGPL-3.0-or-later ([LICENSE](../../LICENSE)); the v0.3.0 engine
has its separate [MIT notice](ENGINE-LICENSE) and
[public source](https://github.com/brianhliou/misty-banqi/tree/v0.3.0). No model
distribution license is asserted, and this image does not redistribute it.

## Build only the staged context

```sh
npm ci
npm run engine:banqi-host:context -- --out /tmp/mistboard-banqi-host-review
docker buildx build --platform linux/amd64 --load -t mistboard-banqi-provider:local /tmp/mistboard-banqi-host-review
```

Use a fresh output directory: existing directories are refused. The generator
bundles the public kernel/provider/harness, replaces web observability with a
worker-only logger, verifies bundle inputs, and writes exactly these files:
`worker.mjs`, `Dockerfile`, `.dockerignore`, `fetch-release-asset.sh`, `LICENSE`,
`ENGINE-LICENSE`. There is no recursive repository copy. The
Dockerfile uses explicit `COPY` paths and a fail-closed ignore allowlist. Building
that Dockerfile against the checkout instead of the generated context fails
because its required bundle is absent. Never upload the whole checkout.

The Node 22 base image is pinned by digest. No engine compilation or private asset
fetch happens during the image build. For a bounded local builder use Docker's
[container driver resource settings](https://docs.docker.com/build/builders/drivers/docker-container/):

```sh
docker buildx create --name banqi-host-review --driver docker-container --driver-opt memory=1g --driver-opt cpu-period=100000 --driver-opt cpu-quota=100000
docker buildx build --builder banqi-host-review --platform linux/amd64 --load -t mistboard-banqi-provider:local /tmp/mistboard-banqi-host-review
```

## Runtime configuration

| Variable | Required value |
|---|---|
| `PORT` | Platform listener port; default `8080`. |
| `MISTBOARD_BANQI_PROVIDER_TOKEN` | Dedicated random shared worker credential, at least 16 characters. |
| `MISTBOARD_BANQI_TEST_PROVIDER_VERSION` | Exact build/model version derived from the pins; currently `MistyBanqi-0.3.0-iter14`. |
| `MISTBOARD_BANQI_MODEL_SHA256` | Exact `banqi-net` SHA from the public recipe. |
| `MISTBOARD_BANQI_MODEL_PATH` | Optional absolute read-only mounted model. Its bytes must match the image's pin. |
| `MISTBOARD_BANQI_MODEL_DOWNLOAD_TOKEN` | Required only without a model mount; read access to the existing private model release. |

Without a mount, startup fetches bounded GitHub release metadata, resolves exactly
the pinned asset, and checks its bytes. Authenticated requests go only to
`api.github.com`; HTTPS asset redirects are limited to GitHub's asset CDN hosts
and receive no Authorization header. One 30-second budget covers the fetch.
There are no arbitrary download URLs or client-selected commands.

Downloaded bytes go into a fresh private temporary directory (mode 700), file
mode 600, on the host's ephemeral filesystem. Railway storage is not claimed to
be RAM; the local Docker proof uses tmpfs. Startup uses [execve](https://nodejs.org/download/release/latest-jod/docs/api/process.html#processexecvefile-args-env) to replace its process with a
new Node runtime using an explicit environment allowlist. This removes the asset
credential and unrelated web variables from the final Linux process environment,
including `/proc`, before any native engine runs. The native process receives
only its minimal PATH. The scoped worker credential remains in the Node runtime.

## Listener and bounds

The native bridge remains bound to `127.0.0.1` on an ephemeral port. The separate
external listener binds `0.0.0.0:$PORT` and must sit behind platform TLS:

| Route | Access and response |
|---|---|
| `GET /readyz` | Public: only `{"status":"ready"}` or `{"status":"unavailable"}`. |
| `GET /health` | Bearer token: protocol and pinned engine/model version. |
| `POST /turn` | Bearer token: the checked masked `mistboard-banqi/1` contract. |

No listener opens before model verification, exact native UCI-name check and a
real startup search. Readiness probes the actual authenticated loopback bridge;
native transport/configuration failures take readiness down. No request body,
model path, authorization header or raw engine diagnostic is logged.

One native request runs at a time. Admission holds at most two turn requests
(one active, one waiting); later requests receive 429. Request bodies have a
one-second absolute lifetime and 64 KiB cap, headers an 8 KiB cap, and connections
a 64-connection ceiling. The original turn deadline covers admission and search,
with an eight-second maximum; expired requests do no native work. Native output
and HTTP replies are capped at 64 KiB. Disconnection aborts the upstream turn.

SIGTERM stops admission/readiness, drains bounded work, and forces remaining
connections closed after nine seconds. Use at least a 12-second platform drain.
Fetched model files are removed on normal shutdown. CPU/memory/PID controls are
container/host controls; this is **not** a per-process adversarial sandbox or a
claim that native network egress is blocked.

## Repeatable local proof

Lightweight checks are part of `scripts/banqi-host.test.mjs` in the normal tooling
gate, and can also run directly:

```sh
npm run engine:banqi-host:test
```

The Docker proof is deliberately opt-in:

```sh
npm run engine:banqi-host:smoke -- --image mistboard-banqi-provider:local --model /absolute/operator/path/model.bqnn --model-sha <pinned-sha256>
```

It generates an ephemeral credential in memory and supplies it by environment
name, never an argv literal, env file or printed value. It runs Linux/amd64 with
one CPU, 1 GiB memory, 64 PIDs, read-only root filesystem, dropped capabilities,
no-new-privileges and a read-only model mount. Local containers run as the host
UID/GID to read a mode-600 operator file without relaxing that file's permissions.
The public bundle remains readable; production defaults to nonroot `node`.

The proof checks authenticated/unauthorized traffic, startup identity and model
refusals, body/deadline limits, the final environment, image/config secrecy and
graceful stop. It then invokes the existing complete-game driver against the
container endpoint: actual HTTP creation, public-view WS human moves, natural
kernel ending, socket reconnect and quiet-history durable hydration, private
attribution and internal-game exclusions. Test containers are removed on exit;
no model is copied into an image or build context. A successful local container
proof is distinct from an actual Railway deployment or hosted canary.

## Prepared Railway service and operator steps

Use a new service named `banqi-provider-canary`, uploaded only from the generated
context. Do not reuse or modify the old `engine-worker`. The reference
[railway-settings.json](railway-settings.json) describes the direct service settings: the Dockerfile builder, exact startup command,
`/readyz`, a 120-second health allowance, ON_FAILURE with three retries, one
replica in `us-west2`, 1 vCPU, 1,000,000,000 bytes of memory, no sleep, zero overlap and a 12-second
drain. Apply/read back these settings through the current service API; this JSON is
reference material, not automatically loaded Config-as-Code. It is separate from web's Railpack config. No database or volume is needed.
Railway's configuration does not expose the local Docker PID/tmpfs flags; keep
the application admission bound and confirm any additional platform isolation
requirements before using this for an untrusted executable.

The operator provisions only the dedicated worker token and an explicitly
authorized read-only credential for the pinned private model release. Do not share
a web credential with the new service without approval. A read-only model mount is
an alternative. Use the fixed model pin/version above; no broad web environment
copy is needed, and secret values must never be displayed.

The one human-only local preparation command is:

```sh
node scripts/banqi-provider-store-token.mjs
```

It requires an interactive macOS terminal and stores a new random value in the
fixed Keychain item without showing it or overwriting an existing one. After
that step, the existing `railway-secret.mjs` can stage the scoped variable for
the new host and `web` using `--skip-deploys`. This package does not execute the
Keychain step, create production secrets or change any cloud environment.

Only after an approved ship, a scoped upload has this shape:

```sh
command railway up /tmp/mistboard-banqi-host-review --path-as-root --project <project-id> --environment <environment-id> --service banqi-provider-canary --detach -m "Temporary Banqi provider canary"
```

Keep the web canary switch off until the hosted service reports authenticated
matching health and its failure checks pass. Then use the existing admin-only
test-room route and run a complete private game on the intended host. Public
registration, ladder changes, another author's adapter and strength claims are
separate work.

Retire by turning off the web canary switch, allowing active private rooms to
finish or following the normal shutdown pause, then stopping the new service and
removing its scoped configuration/reference. Leave unrelated services and their
credentials untouched; the planned old `engine-worker` shutdown is independent.
Remove the dedicated provider token only when neither side uses it. This package
prepares the host; it deploys nothing.
