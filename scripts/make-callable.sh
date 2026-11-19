#!/usr/bin/env bash
# Makes the LastPick app functions (onCall / onRequest) callable from the app.
# Firebase normally does this on deploy; if a function was deleted and recreated
# it can be left private, and every call then fails with 403 ("internal" in the app).
# Only touches functions whose names start with "lp" - the laundry app is not changed.
set -uo pipefail
REGION=asia-south1
cd "$(dirname "$0")/.."
NAMES=$(grep -oE "^exports\.lp[A-Za-z]+ = on(Call|Request)" functions/index.js | sed -E 's/exports\.([A-Za-z]+).*/\1/' | tr 'A-Z' 'a-z')
for s in $NAMES; do
  if gcloud run services add-iam-policy-binding "$s" --region "$REGION" \
       --member=allUsers --role=roles/run.invoker --quiet >/dev/null 2>/tmp/lp-callable.err; then
    echo "ok   $s"
  else
    echo "FAIL $s: $(tail -1 /tmp/lp-callable.err)"
  fi
done
