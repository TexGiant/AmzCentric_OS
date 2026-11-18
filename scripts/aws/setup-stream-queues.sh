#!/usr/bin/env bash
# AmzCentric OS — Amazon Marketing Stream queue setup (North America, us-east-1).
#
# Creates any missing SQS queues for sp/sb/sd traffic + conversion with the access
# policy Amazon requires, gives the app's IAM user read access to all of them,
# and prints the STREAM_SQS_QUEUE_URLS value for Vercel.
# Existing queues (and their policies) are left untouched.
#
# Run in AWS CloudShell (region N. Virginia):
#   bash setup-stream-queues.sh <STREAM_AWS_ACCESS_KEY_ID>
set -euo pipefail

ACCESS_KEY_ID="${1:?Usage: bash setup-stream-queues.sh <STREAM_AWS_ACCESS_KEY_ID from Vercel>}"
REGION=us-east-1
REVIEWER=arn:aws:iam::926844853897:role/ReviewerRole
# dataset:Amazon SNS sender account (github.com/amzn/amazon-marketing-stream-examples, NA)
DATASETS="sp-traffic:906013806264 sp-conversion:802324068763 sb-traffic:709476672186 sb-conversion:154357381721 sd-traffic:370941301809 sd-conversion:877712924581"

ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
IAM_USER=$(aws iam get-access-key-last-used --access-key-id "$ACCESS_KEY_ID" --query UserName --output text)
echo "AWS account $ACCOUNT · app IAM user: $IAM_USER"
WORK=$(mktemp -d)
URLS=()
ARNS=()

for pair in $DATASETS; do
  Q=${pair%%:*}
  SNS_ACCOUNT=${pair##*:}
  ARN="arn:aws:sqs:$REGION:$ACCOUNT:$Q"
  URL=$(aws sqs get-queue-url --region "$REGION" --queue-name "$Q" --query QueueUrl --output text 2>/dev/null || true)
  if [ -n "$URL" ] && [ "$URL" != "None" ]; then
    echo "exists   $Q (left as is)"
  else
    URL=$(aws sqs create-queue --region "$REGION" --queue-name "$Q" --attributes SqsManagedSseEnabled=true --query QueueUrl --output text)
    jq -n --arg arn "$ARN" --arg acct "$ACCOUNT" --arg sns "arn:aws:sns:$REGION:$SNS_ACCOUNT:*" --arg rev "$REVIEWER" '{
      Version: "2012-10-17",
      Statement: [
        {Sid: "Owner", Effect: "Allow", Principal: {AWS: ("arn:aws:iam::" + $acct + ":root")}, Action: "SQS:*", Resource: $arn},
        {Sid: "AmazonMarketingStreamSNS", Effect: "Allow", Principal: {Service: "sns.amazonaws.com"}, Action: "SQS:SendMessage",
         Resource: $arn, Condition: {ArnLike: {"aws:SourceArn": $sns}}},
        {Sid: "AmazonMarketingStreamReviewer", Effect: "Allow", Principal: {AWS: $rev}, Action: "SQS:GetQueueAttributes", Resource: $arn}
      ]}' >"$WORK/policy.json"
    jq -n --arg p "$(cat "$WORK/policy.json")" '{Policy: $p}' >"$WORK/attrs.json"
    aws sqs set-queue-attributes --region "$REGION" --queue-url "$URL" --attributes "file://$WORK/attrs.json"
    echo "created  $Q"
  fi
  URLS+=("$URL")
  ARNS+=("$ARN")
done

# Let the app's IAM user read and delete messages on all six queues (adds to its existing permissions).
printf '%s\n' "${ARNS[@]}" | jq -R . | jq -s '{
  Version: "2012-10-17",
  Statement: [{Sid: "AmzCentricOSStreamRead", Effect: "Allow",
    Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes", "sqs:ChangeMessageVisibility"],
    Resource: .}]}' >"$WORK/iam.json"
aws iam put-user-policy --user-name "$IAM_USER" --policy-name AmzCentricOS-StreamRead --policy-document "file://$WORK/iam.json"
echo "granted  $IAM_USER read access to ${#ARNS[@]} queues"

echo
echo "Set this as STREAM_SQS_QUEUE_URLS in Vercel, then redeploy:"
(IFS=,; echo "${URLS[*]}")
