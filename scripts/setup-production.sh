#!/usr/bin/env bash
# One-time production setup for LastPick. Run it in Google Cloud Shell (nothing to install on your computer):
#   bash scripts/setup-production.sh you@example.com
# It only touches LastPick's own resources (database "lastpick", functions named lp*) in the shared project.
# Safe to run again.
set -euo pipefail
PROJECT=laundry-staging-c0722
DB=lastpick
EMAIL="${1:?Usage: bash scripts/setup-production.sh your-alert-email@example.com}"
gcloud config set project "$PROJECT" >/dev/null

echo "== 1. APIs (Cloud Tasks queue, monitoring, backups)"
gcloud services enable cloudtasks.googleapis.com monitoring.googleapis.com logging.googleapis.com firestore.googleapis.com clouderrorreporting.googleapis.com

echo "== 1b. Let Cloud Functions create sign-in tokens (needed for one-time-code login)"
PROJECT_NUMBER=$(gcloud projects describe "$PROJECT" --format="value(projectNumber)")
SA="${PROJECT_NUMBER}-compute@developer.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$SA" --member="serviceAccount:$SA" --role="roles/iam.serviceAccountTokenCreator" >/dev/null && echo "   ok: $SA"

echo "== 2. Database backups: daily backup kept 7 days + point-in-time recovery (7 days)"
gcloud firestore databases update --database="$DB" --enable-pitr || true
if ! gcloud firestore backups schedules list --database="$DB" --format="value(name)" | grep -q .; then
  gcloud firestore backups schedules create --database="$DB" --recurrence=daily --retention=7d
fi

echo "== 3. Alert e-mail channel"
CHANNEL=$(gcloud beta monitoring channels list --filter="labels.email_address=$EMAIL" --format="value(name)" | head -n1)
if [ -z "$CHANNEL" ]; then
  CHANNEL=$(gcloud beta monitoring channels create --display-name="LastPick alerts" --type=email --channel-labels=email_address="$EMAIL" --format="value(name)")
fi
echo "   channel: $CHANNEL"

echo "== 4. Log-based metrics for LastPick functions only"
gcloud logging metrics describe lastpick_function_errors >/dev/null 2>&1 || gcloud logging metrics create lastpick_function_errors \
  --description="Errors in LastPick Cloud Functions (lp*)" \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name=~"^lp" AND severity>=ERROR'
gcloud logging metrics describe lastpick_client_errors >/dev/null 2>&1 || gcloud logging metrics create lastpick_client_errors \
  --description="Crashes reported by the LastPick apps" \
  --log-filter='resource.type="cloud_run_revision" AND resource.labels.service_name="lplogclienterror" AND severity>=ERROR'

echo "== 5. Alert policies"
make_policy () { # name metric threshold
  if gcloud alpha monitoring policies list --filter="displayName=\"$1\"" --format="value(name)" | grep -q .; then echo "   exists: $1"; return; fi
  cat > /tmp/policy.json <<JSON
{
  "displayName": "$1",
  "combiner": "OR",
  "conditions": [{
    "displayName": "$1",
    "conditionThreshold": {
      "filter": "metric.type=\"logging.googleapis.com/user/$2\" AND resource.type=\"cloud_run_revision\"",
      "comparison": "COMPARISON_GT", "thresholdValue": $3, "duration": "0s",
      "aggregations": [{ "alignmentPeriod": "600s", "perSeriesAligner": "ALIGN_SUM", "crossSeriesReducer": "REDUCE_SUM" }]
    }
  }],
  "notificationChannels": ["$CHANNEL"],
  "alertStrategy": { "autoClose": "86400s" }
}
JSON
  gcloud alpha monitoring policies create --policy-from-file=/tmp/policy.json >/dev/null && echo "   created: $1"
}
make_policy "LastPick: server errors (more than 10 in 10 min)" lastpick_function_errors 10
make_policy "LastPick: app crashes (more than 20 in 10 min)" lastpick_client_errors 20

echo "== 6. Uptime check on the web app"
gcloud monitoring uptime list-configs --format="value(displayName)" | grep -q "LastPick web" || \
  gcloud monitoring uptime create "LastPick web" --resource-type=uptime-url --resource-labels=host=lastpick-ce569.web.app,project_id="$PROJECT" --path="/" --period=15 || true

echo "== 7. Let the app call the LastPick functions"
bash "$(dirname "$0")/make-callable.sh"

cat <<MSG

Done. Two things need the Console (they can't be scripted safely here):
  * Budget alert: https://console.cloud.google.com/billing/budgets  -> Create budget -> project $PROJECT,
    amount e.g. Rs 2,000/month, alerts at 50%, 90%, 100% to $EMAIL.
    (The project also runs the laundry app, so the budget covers both.)
  * Error Reporting: https://console.cloud.google.com/errors?project=$PROJECT  -> "Turn on notifications".
MSG
