#!/bin/bash
set -e

# Join.cloud Deploy Script
# Usage: ./deploy/deploy.sh [commit message]
# Deploys to AWS, same infrastructure as SuperBI

SERVER="ec2-user@51.102.229.176"
SSH_KEY="$HOME/All/ssh/anyblocks.pem"
SSH="ssh -i $SSH_KEY $SERVER"
RSYNC="rsync -avz -e 'ssh -i $SSH_KEY'"
REMOTE_DIR="~/joincloud"
LOCAL_DIR="$(cd "$(dirname "$0")/.." && pwd)"

COMMIT_MSG="${1:-}"

echo "=== Join.cloud Deploy ==="
echo "Local:  $LOCAL_DIR"
echo "Remote: $SERVER:$REMOTE_DIR"
echo ""

# Step 1: Check for uncommitted changes
cd "$LOCAL_DIR"
if ! git diff --quiet || ! git diff --cached --quiet; then
    echo "WARNING: Uncommitted changes detected. Commit before deploying."
    exit 1
fi
echo ""

# Step 2: Ensure remote directory exists
echo "--- Setting up remote ---"
$SSH "mkdir -p $REMOTE_DIR"

# Step 3: Sync project files
echo "--- Syncing files ---"
eval $RSYNC \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='.env' \
    --exclude='*.log' \
    --exclude='.git' \
    --exclude='mcp-server/node_modules' \
    --exclude='mcp-server/dist' \
    "$LOCAL_DIR/" "$SERVER:$REMOTE_DIR/"
echo ""

# Step 4: Install, build, restart
echo "--- Installing dependencies ---"
$SSH "cd $REMOTE_DIR && npm install 2>&1 | tail -3"
echo ""

echo "--- Building ---"
$SSH "cd $REMOTE_DIR && npm run build 2>&1 | tail -3"
echo ""

echo "--- Setting up environment ---"
$SSH "cd $REMOTE_DIR && if [ ! -f .env ]; then echo 'DATABASE_URL=postgres://localhost:5432/joincloud' > .env && echo 'PORT=3002' >> .env && echo 'MCP_PORT=3003' >> .env && echo 'REPOS_DIR=/home/ec2-user/joincloud-repos' >> .env; fi"

echo "--- Ensuring database exists ---"
$SSH "createdb joincloud 2>/dev/null || echo 'Database already exists'"

echo "--- Restarting service ---"
$SSH "cd $REMOTE_DIR && pm2 delete joincloud 2>/dev/null; DATABASE_URL='postgres://postgres@127.0.0.1:5432/interagent' PORT=3002 MCP_PORT=3003 REPOS_DIR=/home/ec2-user/joincloud-repos pm2 start dist/index.js --name joincloud"
echo ""

# Step 5: Update nginx config
echo "--- Updating nginx config ---"
$SSH "sudo cp $REMOTE_DIR/deploy/nginx-join.cloud.conf /etc/nginx/conf.d/join.cloud.conf && sudo certbot --nginx -d join.cloud --non-interactive --agree-tos --redirect && sudo nginx -t && sudo nginx -s reload"
echo ""

# Step 6: Verify
echo "--- Verifying ---"
sleep 2
$SSH "pm2 status joincloud"
echo ""

echo "=== Deploy complete ==="
echo "Website:    https://join.cloud"
echo "A2A:        POST https://join.cloud/a2a"
echo "MCP:        POST https://join.cloud/mcp"
echo "Agent Card: https://join.cloud/.well-known/agent-card.json"
echo "SSE:        https://join.cloud/api/messages/:roomId/sse"
