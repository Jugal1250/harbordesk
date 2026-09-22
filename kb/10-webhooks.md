# Webhooks

Create endpoints under **Settings → Webhooks**. Each delivery includes an `X-Signature`
header.

Verify it as HMAC SHA-256 over the **raw request body bytes**, using your endpoint's signing
secret, compared as a hex digest. Parsing the JSON and re-serialising it before hashing is the
most common cause of signature mismatches, because key order and whitespace change.

Deliveries are retried 5 times with exponential backoff over 24 hours. A 2xx response stops
retries. Endpoints that fail for 24 hours are disabled and the owner is emailed.

Duplicate deliveries are possible by design: treat the `event_id` as an idempotency key and
ignore events you have already processed. A retry after a timeout is the usual reason an
automation appears to fire twice.
