# Slack integration

Connect under **Settings → Integrations → Slack**, then choose the channel that should
receive notifications. You can send job updates, new comments and daily digests.

If notifications stop arriving:
- Check the channel still exists and has not been archived. Archived channels fail silently.
- If our app was removed from the channel, reconnect and re-select the channel.
- Slack tokens expire when a Slack workspace admin revokes app access; reconnecting issues a
  new token.

The connection status shown on our settings page reflects our token, not channel membership,
so it can read "active" while posts are failing. The delivery log under
Integrations → Slack → Recent deliveries shows the real result of each attempt.
