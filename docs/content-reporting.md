# Content engagement in the operating readout

The existing daily readout workflow produces the report. Monday's weekly email
adds a short Content section; Ops → Activity (`/ops?tab=activity#content`) reads
that same stored JSON snapshot. No additional schedule, subscription or email
is created. The database completed-human-game metric remains the headline.

## Activation

Create a dedicated PostHog personal API key with **Query:Read** access for
Mistboard project **413256**, then configure the server runtime secret
`MISTBOARD_POSTHOG_REPORTING_API_KEY` through the hosting provider's secret UI.
Do not use the public ingestion key or the source-map upload credential. Do not
paste the key into a repository, command, issue or log. There is no credential
configuration in the browser or GitHub workflow.

Without the key, content is explicitly unavailable and normal operational
health grading and delivery continue. A configured provider failure or malformed
response is also unavailable; it is never converted to zero traffic. Search
Console/Bing context remains unavailable until an explicitly dated source is
integrated.

After configuration, use the existing workflow's weekly **dry run**. Inspect its
redacted JSON/Markdown artifact for `content.status: available`, the current
28-complete-UTC-day window, the preceding nonoverlapping window, and the inventory.
Dry runs neither persist nor send. The next normal generation bootstraps content
if no usable stored snapshot exists. Weekly generation refreshes it; ordinary
daily reports reuse the latest successful content facts with the original
`collectedAt` and period boundaries. A scheduled retry reuses its snapshot before
any external request and does not send a duplicate email.

## Collection and interpretation

Six aggregate HogQL queries (three per window) run serially against the fixed
PostHog US query endpoint outside the database transaction/advisory lock. The
collector has a 90-second total deadline (test configuration capped at 120 seconds),
500-row query limit (a response reaching that limit fails closed), and a 1 MB
response limit. Redirects are rejected. The workflow allows 180 seconds for the
collector and remaining report generation. Credentials, individual identifiers,
event payloads and raw provider errors are never stored in content facts.

The generated article metadata is the inventory; run `npm run articles:meta`
after article metadata changes. Drafts, future articles, rules pages and unknown
paths are excluded. Only visits after publication enter attribution. English,
zh-Hans and zh-Hant paths combine with distinct person/session counts; Vietnamese
slugs stay separate. A true zero is possible only after all queries validate.

Observed visitors can include automation and omit analytics opt-outs. Internal
sessions are excluded; return cohorts conservatively exclude any person flagged
internal during the window. Study/puzzle/game outcomes must follow the article
view in its session; game lifecycle events join on gameId. Assisted outcomes
can overlap across posts and must not be summed as independent acquisitions.
First recorded players are first observed starts since 2026-05-01 after an
article view in that session. Entry first players also require the session to
enter on that article. Prior and first players can overlap across repeat visits;
neither is a database completed human game. Mature
return cohorts require eight elapsed days and a subsequent pageview one to seven
days after the first actual blog view. Replay coverage is limited to the xiangqi
component. First-move coverage begins 2026-10-25; human_input begins 2026-11-05
and is not a human-reader denominator. Reading completion/time are unmeasured.

## Local verification

`content-readout.test.ts` injects a fetch transport and synthetic aggregate
fixtures. `content-readout-generation.test.ts` checks retry, daily reuse,
bootstrap, dry-run and transaction ordering without a provider or database.
`apps/web/src/content-readout.test.ts` checks the admin renderer with synthetic
stored data. The weekly email renderer takes the same snapshot directly;
`renderReadoutEmail(report)` returns HTML/text without sending it. Production
analytics fixtures must stay outside version control.
