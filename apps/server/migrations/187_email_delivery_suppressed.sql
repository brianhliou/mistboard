-- Suppression is distinct from both a hard bounce and a temporary send failure.
ALTER TABLE email_delivery_events DROP CONSTRAINT email_delivery_events_event_type_check;
ALTER TABLE email_delivery_events ADD CONSTRAINT email_delivery_events_event_type_check
  CHECK (event_type IN (
    'email.sent', 'email.delivered', 'email.delivery_delayed',
    'email.bounced', 'email.complained', 'email.failed', 'email.suppressed'
  ));

ALTER TABLE email_delivery_addresses DROP CONSTRAINT email_delivery_addresses_status_check;
ALTER TABLE email_delivery_addresses ADD CONSTRAINT email_delivery_addresses_status_check
  CHECK (status IN (
    'sent', 'delivered', 'delivery_delayed', 'bounced', 'complained', 'failed', 'suppressed'
  ));
