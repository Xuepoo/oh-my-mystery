#!/usr/bin/env bash
# deploy-pages.sh — Deploy site to Cloudflare Pages and handle wrangler hang
# Usage: ./deploy-pages.sh <public_dir> <project_name> <branch>

set -euo pipefail

PUBLIC_DIR="${1:-apps/web/dist}"
PROJECT_NAME="${2:-omm}"
BRANCH="${3:-main}"

if ! command -v wrangler &>/dev/null; then
    echo "ERROR: wrangler not found. Ensure wrangler is installed." >&2
    exit 1
fi

echo "Deploying ${PUBLIC_DIR} to Cloudflare Pages (Project: ${PROJECT_NAME}, Branch: ${BRANCH})..."
workspace_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
mkdir -p "$workspace_root/tmp"
log_file=$(mktemp "$workspace_root/tmp/pages-deploy.XXXXXX.log")
wrangler_pid=""

cleanup() {
    if [ -n "$wrangler_pid" ] && kill -0 "$wrangler_pid" 2>/dev/null; then
        kill "$wrangler_pid" 2>/dev/null || true
        wait "$wrangler_pid" 2>/dev/null || true
    fi
    rm -f "$log_file"
}

trap cleanup EXIT

# Clear proxies because wrangler fetch fails when using them
env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy \
CI=true CLOUDFLARE_TELEMETRY_DISABLED=1 NO_UPDATE_NOTIFIER=1 wrangler pages deploy "${PUBLIC_DIR}" --project-name "${PROJECT_NAME}" --branch "${BRANCH}" --commit-dirty=true > "$log_file" 2>&1 &
wrangler_pid=$!

success=false
last_line_count=0

# Stream log and check status
for _ in {1..300}; do
    # Print new lines to stdout
    if [ -f "$log_file" ]; then
        current_lines=$(wc -l < "$log_file")
        if [ "$current_lines" -gt "$last_line_count" ]; then
            tail -n +"$((last_line_count + 1))" "$log_file"
            last_line_count=$current_lines
        fi
    fi

    # Check for success pattern
    if grep -q "Deployment complete!" "$log_file" 2>/dev/null; then
        success=true
        break
    fi

    # Check if process died
    if ! kill -0 "$wrangler_pid" 2>/dev/null; then
        if grep -q "Deployment complete!" "$log_file" 2>/dev/null; then
            success=true
        fi
        break
    fi
    sleep 0.5
done

# Print any remaining lines
if [ -f "$log_file" ]; then
    current_lines=$(wc -l < "$log_file")
    if [ "$current_lines" -gt "$last_line_count" ]; then
        tail -n +"$((last_line_count + 1))" "$log_file"
    fi
fi

if [ "$success" = true ]; then
    echo "✨ Cloudflare Pages deployment finished successfully!"
    exit 0
else
    echo "❌ Cloudflare Pages deployment failed!" >&2
    exit 1
fi
