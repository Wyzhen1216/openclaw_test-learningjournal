#!/bin/bash
# Email sending script for OpenClaw
# Usage: ./send-email.sh <to> <subject> <body> [from]

set -e

TO="$1"
SUBJECT="$2"
BODY="$3"
FROM="${4:-$USER@$(hostname)}"

if [ -z "$TO" ] || [ -z "$SUBJECT" ] || [ -z "$BODY" ]; then
    echo "Usage: $0 <to> <subject> <body> [from]"
    exit 1
fi

# Try sendmail first, fallback to mail
if command -v sendmail >/dev/null 2>&1; then
    {
        echo "From: $FROM"
        echo "To: $TO"
        echo "Subject: $SUBJECT"
        echo "Content-Type: text/plain; charset=UTF-8"
        echo ""
        echo "$BODY"
    } | sendmail "$TO"
    echo "Email sent to $TO via sendmail"
elif command -v mail >/dev/null 2>&1; then
    echo "$BODY" | mail -s "$SUBJECT" "$TO"
    echo "Email sent to $TO via mail"
else
    echo "Error: No mail sending tool found (sendmail or mail required)"
    exit 1
fi
