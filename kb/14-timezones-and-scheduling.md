# Time zones and scheduling

Each workspace has a **default time zone** set under Settings → General. Every scheduled time
is stored in UTC and displayed in the viewer's time zone.

Individual members can override the display time zone under their own profile. When a member's
profile time zone differs from the workspace, times appear shifted for that person only, which
is the usual cause of "the job shows two hours later for my drivers".

Daylight saving changes are applied automatically using the IANA database. Jobs scheduled
across a DST boundary keep their local wall-clock time.

To check what a member sees, open Members → the person → **View as**, which shows their
effective time zone.
