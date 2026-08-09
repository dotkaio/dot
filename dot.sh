#!/usr/bin/env bash
set -euo pipefail

SCRIPT_PATH="${BASH_SOURCE[0]}"
while [[ -L "$SCRIPT_PATH" ]]; do
  SCRIPT_PATH_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
  SCRIPT_PATH="$(readlink "$SCRIPT_PATH")"
  if [[ "$SCRIPT_PATH" != /* ]]; then
    SCRIPT_PATH="$SCRIPT_PATH_DIR/$SCRIPT_PATH"
  fi
done
SCRIPT_DIR="$(cd -P "$(dirname "$SCRIPT_PATH")" && pwd)"
CLI_ENTRY="$SCRIPT_DIR/packages/coding-agent/src/cli.ts"
SOURCE_PATHS_REGISTER="$SCRIPT_DIR/scripts/register-source-paths.mjs"

if [[ ! -d "$SCRIPT_DIR/node_modules" ]]; then
  printf 'dot: dependencies are not installed; run "npm ci --ignore-scripts"  in %s\n' "$SCRIPT_DIR" >&2
  exit 1
fi

if [[ ! -f "$CLI_ENTRY" ]]; then
  printf 'dot: source entry point not found: %s\n' "$CLI_ENTRY" >&2
  exit 1
fi

if [[ ! -f "$SOURCE_PATHS_REGISTER" ]]; then
  printf 'dot: source path register not found: %s\n' "$SOURCE_PATHS_REGISTER" >&2
  exit 1
fi

if [[ -z "${NODE_COMPILE_CACHE:-}" ]]; then
  export NODE_COMPILE_CACHE="$SCRIPT_DIR/node_modules/.cache/dot-node-compile-cache"
fi

# Check for --no-env flag
NO_ENV=false
ARGS=()
for arg in "$@"; do
  if [[ "$arg" == "--no-env" ]]; then
    NO_ENV=true
  else
    ARGS+=("$arg")
  fi
done

if [[ "$NO_ENV" == "true" ]]; then
  # Unset API keys (see packages/ai/src/env-api-keys.ts)
  unset ANTHROPIC_API_KEY
  unset ANTHROPIC_OAUTH_TOKEN
  unset OPENAI_API_KEY
  unset GEMINI_API_KEY
  unset GROQ_API_KEY
  unset CEREBRAS_API_KEY
  unset XAI_API_KEY
  unset OPENROUTER_API_KEY
  unset ZAI_API_KEY
  unset MISTRAL_API_KEY
  unset MINIMAX_API_KEY
  unset MINIMAX_CN_API_KEY
  unset AI_GATEWAY_API_KEY
  unset OPENCODE_API_KEY
  unset COPILOT_GITHUB_TOKEN
  unset GH_TOKEN
  unset GITHUB_TOKEN
  unset HF_TOKEN
  unset GOOGLE_APPLICATION_CREDENTIALS
  unset GOOGLE_CLOUD_PROJECT
  unset GCLOUD_PROJECT
  unset GOOGLE_CLOUD_LOCATION
  unset AWS_PROFILE
  unset AWS_ACCESS_KEY_ID
  unset AWS_SECRET_ACCESS_KEY
  unset AWS_SESSION_TOKEN
  unset AWS_REGION
  unset AWS_DEFAULT_REGION
  unset AWS_BEARER_TOKEN_BEDROCK
  unset AWS_CONTAINER_CREDENTIALS_RELATIVE_URI
  unset AWS_CONTAINER_CREDENTIALS_FULL_URI
  unset AWS_WEB_IDENTITY_TOKEN_FILE
  unset AZURE_OPENAI_API_KEY
  unset AZURE_OPENAI_BASE_URL
  unset AZURE_OPENAI_RESOURCE_NAME
  echo "Running without API keys..."
fi

exec node --import "$SOURCE_PATHS_REGISTER" "$CLI_ENTRY" ${ARGS[@]+"${ARGS[@]}"}
