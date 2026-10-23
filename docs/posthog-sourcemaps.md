# Private web source maps

Mistboard issue [#561](https://github.com/brianhliou/mistboard/issues/561).

The web build uses the pinned official `@posthog/rollup-plugin` with Vite 8.
It injects chunk IDs before final file hashes are settled, uploads hidden
source maps to PostHog project **413256**, and removes every `.map` from the
deployable directory. Uploading never rewrites the final JavaScript files.
The release is `mistboard-web` at `RAILWAY_GIT_COMMIT_SHA`, or the checkout's
Git HEAD for a local build. The production engine-worker build skips web.

## One-time production setup

The Railway **web** service needs `POSTHOG_CLI_API_KEY`: a PostHog personal
API key with **error tracking write** and **organization read**, scoped to
the Mistboard project. The browser's public project key cannot upload maps.
Create it through [PostHog's API key settings](https://us.posthog.com/settings/user-api-keys).
Never put it in a `VITE_*` variable, a file, a commit, or a chat message.

Set it in your own terminal with hidden input. `--skip-deploys` stages the
configuration without restarting live games; the next approved batch ship
builds with it. This is a zsh command, matching the local operator shell:

```sh
read -rs 'posthog_upload_key?PostHog personal upload key: '
printf '%s' "$posthog_upload_key" | command railway variable set POSTHOG_CLI_API_KEY \
  --stdin --skip-deploys --service web --environment production \
  --project edd519d3-638e-40da-81b4-a8a70eb7eb94 >/dev/null
unset posthog_upload_key
```

Do not include this branch in a production batch until the key is configured.
An unconfigured production build stops with a named configuration error.
An authenticated upload failure also fails the build. Maps are removed even
when upload fails; failed cleanup itself fails the build.

## Local builds and CI

Normal local/CI builds without a key inject chunk IDs and exercise cleanup
with the official CLI in explicit offline mode. They do **not** upload maps
and say so in the build output. Development serving does not load the plugin.
The wrapper suppresses raw CLI output so an authentication error cannot echo
a credential. It passes the key only in the child environment, never argv,
ignores dotenv-file overrides, and prevents an authenticated build from
accidentally inheriting dry-run mode.

```sh
node --test scripts/posthog-sourcemaps.test.mjs
npm run build --workspace @mistboard/web
```

The integration fixture builds actual minified JavaScript through Vite and
the official plugin, captures the private map at the upload boundary, and
resolves an actual thrown error back to the exact TypeScript source line.
It also checks that the final JS bytes are unchanged after upload, maps and
source-map references are absent from public output, credentials are absent
from the JS, and an upload refusal cannot leave deployable source maps.

## After the next batch ship

Verify a newly captured exception from that deployed revision in PostHog:
its application frames should resolve to original TypeScript filenames,
line numbers and code context. Inspect the symbol set by the frame's chunk
ID if they do not. Local mapping tests are not a claim that a production
upload or mapped production exception has already been observed.

The October 19 puzzle example in the issue investigation was from an older
build without maps. This change does not recover old maps or fix the
underlying failed request; it makes new reports actionable.

References: [PostHog's Vite integration](https://posthog.com/docs/error-tracking/upload-source-maps/vite),
[stack traces](https://posthog.com/docs/error-tracking/stack-traces).
