-- Provider events deliberately have no login-request FK: webhooks may beat the
-- send response, and login challenges are short-lived. Never retain mail bodies.
CREATE TABLE email_delivery_events (
  event_id TEXT PRIMARY KEY,
  provider_email_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.bounced', 'email.complained', 'email.failed'
  )),
  recipients TEXT[] NOT NULL CHECK (cardinality(recipients) > 0),
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  bounce JSONB,
  failure_reason TEXT
);
CREATE INDEX email_delivery_events_provider ON email_delivery_events (provider_email_id, occurred_at);
CREATE INDEX email_delivery_events_window ON email_delivery_events (event_type, occurred_at);
CREATE INDEX email_delivery_events_recipients ON email_delivery_events USING gin (recipients);

CREATE TABLE email_delivery_addresses (
  email TEXT PRIMARY KEY CHECK (email = lower(btrim(email)) AND email <> ''),
  status TEXT NOT NULL CHECK (status IN (
    'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed'
  )),
  status_rank SMALLINT NOT NULL,
  event_count INTEGER NOT NULL DEFAULT 1,
  counts JSONB NOT NULL,
  first_event_at TIMESTAMPTZ NOT NULL,
  last_event_at TIMESTAMPTZ NOT NULL,
  last_event_id TEXT NOT NULL,
  last_delivered_at TIMESTAMPTZ,
  last_bounced_at TIMESTAMPTZ,
  last_complained_at TIMESTAMPTZ,
  last_bounce_event_id TEXT,
  bounce JSONB,
  failure_reason TEXT
);

CREATE TABLE login_email_requests (
  request_id TEXT PRIMARY KEY,
  email TEXT NOT NULL CHECK (email = lower(btrim(email)) AND email <> ''),
  requested_at TIMESTAMPTZ NOT NULL,
  provider_email_id TEXT UNIQUE,
  completed_at TIMESTAMPTZ CHECK (completed_at >= requested_at)
);
CREATE INDEX login_email_requests_window ON login_email_requests (requested_at);
CREATE INDEX login_email_requests_address ON login_email_requests (email, requested_at);
