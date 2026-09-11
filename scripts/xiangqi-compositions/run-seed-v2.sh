#!/bin/sh
# Invoked via: command railway run -s Postgres -- sh <this> [--dry-run] [--replace]
#
# railway run injects the Postgres service env. The internal host only resolves
# inside Railway's network, so a laptop run needs the PUBLIC url. Done in a script
# rather than as an inline prefix because nesting the quoting through `sh -c`
# silently dropped the override once already.
#
# The value is expanded here and handed to the child. It is never echoed.
set -e
S=/private/tmp/claude-501/-Users-brianliou-projects-mistboard/3d8642e6-80f1-4d8c-bdc0-d062476f33d1/scratchpad
APP=/Users/brianliou/projects/mistboard-study

if [ -z "$DATABASE_PUBLIC_URL" ]; then
  echo "DATABASE_PUBLIC_URL not set; run through 'railway run -s Postgres'" >&2
  exit 1
fi

DATABASE_URL="$DATABASE_PUBLIC_URL" exec node "$S/seed-v2.mjs" \
  --app "$APP" \
  --data "$S/sqyq-full.json" \
  --titles "$S/titles-en.json" \
  --email brian@mistboard.com \
  --visibility unlisted \
  "$@"
