#!/bin/sh
# SpeechBridge — predown hook (macOS / Linux)
#
# Removes the Microsoft Entra app registration created during provisioning.
#
# `azd down` only deletes ARM resources, and an app registration is not one — so without
# this, every deploy/destroy cycle leaves another orphan in the tenant. Clean-up should be
# as complete as set-up.

CLIENT_ID=$(azd env get-value AUTH_CLIENT_ID 2>/dev/null || true)

if [ -z "$CLIENT_ID" ]; then
  echo "predown: no app registration recorded for this environment."
  exit 0
fi

echo "Removing Microsoft Entra app registration ${CLIENT_ID} ..."

if az ad app delete --id "$CLIENT_ID" 2>/dev/null; then
  echo "  removed"
  azd env set AUTH_CLIENT_ID "" >/dev/null 2>&1 || true
else
  echo "WARNING: Could not delete app registration ${CLIENT_ID}."
  echo "It may already be gone, or your account may lack permission. Remove it manually with:"
  echo "    az ad app delete --id ${CLIENT_ID}"
fi

exit 0
