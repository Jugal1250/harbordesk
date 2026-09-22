# Two-factor authentication and SSO

**Two-factor authentication** supports authenticator apps (TOTP) such as 1Password, Authy and
Google Authenticator, and hardware keys (WebAuthn). We do not offer SMS codes.

Admins can require 2FA for everyone: **Settings → Security → Require two-factor**. Members
without 2FA are prompted to set it up at their next sign-in and cannot skip it.

**SSO** with SAML 2.0 and SCIM provisioning is available on the Scale plan. Setup guides exist
for Okta, Entra ID and Google Workspace. With SCIM enabled, removing a user in your identity
provider deactivates them here within minutes.

Recovery codes are shown once when 2FA is enabled. Admins can reset 2FA for a member from the
Members page if recovery codes are lost.
