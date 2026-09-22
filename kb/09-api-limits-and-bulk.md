# API rate limits and bulk endpoints

Base URL: `https://api.harbordesk.example/v2`. Authenticate with a bearer token created under
**Settings → API tokens**.

Limits:
- 600 requests per minute per token.
- Bulk endpoints accept **up to 100 items per request**. Larger payloads are rejected; a
  payload above roughly 200 items can exceed the gateway body limit and surface as a 500
  rather than a clean 400.
- Responses are paginated at 100 records with a `next_cursor`.

For large nightly syncs, use `POST /v2/jobs/bulk` in batches of 100 with 200ms between calls,
or request async import access from support, which accepts a single file of up to 50,000 rows.

Deleting a user does **not** automatically revoke API tokens they created. Revoke tokens
explicitly under Settings → API tokens.
