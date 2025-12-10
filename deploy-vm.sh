#!/bin/bash
# Deployment script for Google Compute Engine VM

set -e

echo "🚀 Discord Spotify Bot - VM Deployment Script"
echo "=============================================="

# Update system
echo "📦 Updating system packages..."
sudo apt-get update

# Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install ffmpeg and other dependencies
echo "📦 Installing ffmpeg and dependencies..."
sudo apt-get install -y ffmpeg python3 curl ca-certificates git

# Install yt-dlp
echo "📦 Installing yt-dlp..."
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp

# Install pm2 globally
echo "📦 Installing pm2..."
sudo npm install -g pm2

# Clone or pull the repository
REPO_DIR="/home/$USER/discord-spotify-bot"
REPO_URL="https://github.com/Aristotlev/discord-spotify-bot.git"

if [ -d "$REPO_DIR" ]; then
    echo "📂 Repository exists, pulling latest..."
    cd "$REPO_DIR"
    git pull origin main
else
    echo "📂 Cloning repository..."
    git clone "$REPO_URL" "$REPO_DIR"
    cd "$REPO_DIR"
fi

# Install dependencies
echo "📦 Installing npm dependencies..."
npm ci

# Build TypeScript
echo "🔨 Building TypeScript..."
npm run build

# Check if .env exists
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found! Create one with:"
    echo ""
    echo "cat > .env << 'EOF'"
    echo "DISCORD_TOKEN=your_discord_token"
    echo "DISCORD_CLIENT_ID=your_discord_client_id"
    echo "SPOTIFY_CLIENT_ID=your_spotify_client_id"
    echo "SPOTIFY_CLIENT_SECRET=your_spotify_client_secret"
    echo "SPOTIFY_REDIRECT_URI=https://YOUR_VM_IP:8080/callback"
    echo "PORT=8080"
    echo "EOF"
    echo ""
    echo "Then run: pm2 start dist/index.js --name discord-spotify-bot"
    exit 1
fi

# Stop existing pm2 process if running
pm2 stop discord-spotify-bot 2>/dev/null || true
pm2 delete discord-spotify-bot 2>/dev/null || true

# Start with pm2
echo "🚀 Starting bot with pm2..."
pm2 start dist/index.js --name discord-spotify-bot

# Save pm2 process list and set up startup script
pm2 save
pm2 startup | tail -1 | bash 2>/dev/null || echo "Run 'pm2 startup' manually if needed"

echo ""
echo "✅ Deployment complete!"
echo ""
echo "📋 Useful commands:"
echo "   pm2 logs discord-spotify-bot  - View logs"
echo "   pm2 restart discord-spotify-bot - Restart bot"
echo "   pm2 status - Check status"
echo ""
echo "🔒 Don't forget to:"
echo "   1. Open port 8080 in GCP firewall for OAuth callback"
echo "   2. Set up SSL certs in ./certs/ folder (or use Cloudflare)"
echo "   3. Update Spotify redirect URI to match your VM's IP/domain"
