#!/bin/sh
# Seed a mined manual into studies, with the Postgres credential supplied by
# Railway rather than by a human.
#
#   command railway run -s Postgres -- sh run-seed-v2.sh \
#     --app <repo checkout> --data <mined.json> --titles <titles-en.json> \
#     [--dry-run] [--replace]
#
# railway run injects the Postgres service env. The internal host only resolves
# inside Railway's network, so a laptop run needs the PUBLIC url. Done in a script
# rather than as an inline prefix because nesting the quoting through `sh -c`
# silently dropped the override once already.
#
# The value is expanded here and handed to the child. It is never echoed.
#
# `command railway` (not bare `railway`) matters: a shell function in the Claude
# Code snapshot injects a stale API token that shadows the working browser login.
set -e

HERE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)

if [ -z "$DATABASE_PUBLIC_URL" ]; then
  echo "DATABASE_PUBLIC_URL not set; run through 'command railway run -s Postgres'" >&2
  exit 1
fi

# Every path is an argument now. The previous version hardcoded a session
# scratchpad that was later deleted, which is how this whole pipeline came to
# exist only inside a transcript.
DATABASE_URL="$DATABASE_PUBLIC_URL" exec node "$HERE/seed-v2.mjs" \
  --email brian@mistboard.com \
  --visibility unlisted \
  "$@"
