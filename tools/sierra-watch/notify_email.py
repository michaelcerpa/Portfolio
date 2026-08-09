#!/usr/bin/env python3
"""Email the new openings. Opt-in: silently no-ops unless SMTP secrets are set.

The repo had no existing mail path when this was written, so nothing is
hardcoded — configure these repo secrets to switch it on:

    SMTP_HOST, SMTP_USER, SMTP_PASS, NOTIFY_TO   (SMTP_PORT optional, default 587)

Without them the GitHub issue remains the notification channel.
"""

import os
import smtplib
import ssl
import sys
from email.message import EmailMessage

REQUIRED = ("SMTP_HOST", "SMTP_USER", "SMTP_PASS", "NOTIFY_TO")


def main():
    if len(sys.argv) < 2:
        print("usage: notify_email.py <body.md>", file=sys.stderr)
        return 2

    missing = [k for k in REQUIRED if not os.environ.get(k)]
    if missing:
        print("SMTP not configured ({} unset) — skipping email; "
              "the GitHub issue is the notification.".format(", ".join(missing)))
        return 0

    try:
        with open(sys.argv[1], "r", encoding="utf-8") as fh:
            body = fh.read().strip()
    except OSError as exc:
        print("cannot read {}: {}".format(sys.argv[1], exc), file=sys.stderr)
        return 1

    if not body:
        print("empty body — nothing to send.")
        return 0

    msg = EmailMessage()
    msg["Subject"] = "Sierra: a site opened for Sep 5-6"
    msg["From"] = os.environ["SMTP_USER"]
    msg["To"] = os.environ["NOTIFY_TO"]
    msg.set_content(body)

    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT") or 587)
    ctx = ssl.create_default_context()

    try:
        if port == 465:
            with smtplib.SMTP_SSL(host, port, context=ctx, timeout=30) as s:
                s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
                s.send_message(msg)
        else:
            with smtplib.SMTP(host, port, timeout=30) as s:
                s.starttls(context=ctx)
                s.login(os.environ["SMTP_USER"], os.environ["SMTP_PASS"])
                s.send_message(msg)
    except (smtplib.SMTPException, OSError) as exc:
        # Loud, but don't fail the run — the issue already notified.
        print("email failed: {}".format(exc), file=sys.stderr)
        return 1

    print("emailed {}".format(os.environ["NOTIFY_TO"]))
    return 0


if __name__ == "__main__":
    sys.exit(main())
