# Password reset and login problems

Select **Forgot password** on the sign-in page. The reset link is valid for **60 minutes**
and can be used once. Requesting a new link invalidates all earlier ones, so always use the
most recent email.

If reset emails do not arrive:
1. Check spam and any quarantine your mail provider runs.
2. Ask your IT team to allow `no-reply@harbordesk.example`.
3. Confirm the address is the one on the account; the reset email is only sent to a
   registered address.

**Session expired immediately after login** usually means the browser is blocking our
session cookie, most often from a third-party cookie policy or a corporate proxy rewriting
requests. Try a private window first. If every user in a workspace is affected at once,
contact support: it is usually an identity provider or SSO certificate that has expired.
