
#!/bin/bash
# Deployment script for Google Compute Engine VM
# Simple, direct deployment - no Cloudflare needed

set -e

echo "🚀 Discord Spotify Bot - VM Deployment Script"
echo "=============================================="

# Get external IP
EXTERNAL_IP=$(curl -s ifconfig.me)
echo "🌐 Your VM's external IP: $EXTERNAL_IP"

# Update system
echo "📦 Updating system packages..."
sudo apt-get update

# Install Node.js 20
echo "📦 Installing Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install ffmpeg and other dependencies
echo "📦 Installing ffmpeg and dependencies..."
sudo apt-get install -y ffmpeg python3 curl ca-certificates git build-essential

# Install native audio dependencies for @discordjs/opus
echo "📦 Installing native audio libraries for Opus..."
sudo apt-get install -y libtool autoconf automake libopus-dev

# Install yt-dlp
echo "📦 Installing yt-dlp..."
sudo curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
sudo chmod a+rx /usr/local/bin/yt-dlp
echo "✅ yt-dlp installed at /usr/local/bin/yt-dlp"

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

# Generate self-signed SSL certificate for the VM's IP
echo "🔒 Setting up SSL certificate..."
mkdir -p certs
if [ ! -f "certs/cert.pem" ]; then
    echo "📜 Generating self-signed SSL certificate for $EXTERNAL_IP..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout certs/key.pem \
        -out certs/cert.pem \
        -subj "/CN=$EXTERNAL_IP" \
        -addext "subjectAltName=IP:$EXTERNAL_IP"
    echo "✅ SSL certificate created"
else
    echo "✅ SSL certificate already exists"
fi

# Check if .env exists
if [ ! -f ".env" ]; then
    echo ""
    echo "⚠️  No .env file found!"
    echo ""
    echo "Creating template .env file..."
    cat > .env << EOF
DISCORD_TOKEN=your_discord_token_here
DISCORD_CLIENT_ID=your_discord_client_id_here
SPOTIFY_CLIENT_ID=your_spotify_client_id_here
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret_here
SPOTIFY_REDIRECT_URI=https://${EXTERNAL_IP}:8080/callback
PORT=8080
EOF
    echo ""
    echo "📝 Edit the .env file with your actual credentials:"
    echo "   nano .env"
    echo ""
    echo "Then restart with: pm2 restart discord-spotify-bot"
    echo ""
fi

# Stop existing pm2 process if running
pm2 stop discord-spotify-bot 2>/dev/null || true
pm2 delete discord-spotify-bot 2>/dev/null || true

# Start with pm2 (with auto-restart on crash)
echo "🚀 Starting bot with pm2..."
pm2 start dist/index.js --name discord-spotify-bot --max-restarts 10 --restart-delay 5000

# Set up pm2 to start on boot (this is the key for 24/7 operation)
echo "🔄 Configuring pm2 to start on system boot..."

# Generate the startup command and execute it with sudo
STARTUP_CMD=$(pm2 startup systemd -u $USER --hp /home/$USER 2>/dev/null | grep "sudo" | head -1)
if [ -n "$STARTUP_CMD" ]; then
    echo "Running: $STARTUP_CMD"
    eval $STARTUP_CMD
fi

# Save the current process list
pm2 save

# Enable and start the pm2 service explicitly
sudo systemctl enable pm2-$USER 2>/dev/null || true
sudo systemctl start pm2-$USER 2>/dev/null || true

echo ""
echo "✅ Deployment complete!"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 NEXT STEPS:"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "1️⃣  Update Spotify Dashboard:"
echo "    Add this redirect URI: https://${EXTERNAL_IP}:8080/callback"
echo "    URL: https://developer.spotify.com/dashboard"
echo ""
echo "2️⃣  Edit your .env file with real credentials:"
echo "    nano ~/discord-spotify-bot/.env"
echo ""
echo "3️⃣  Restart the bot:"
echo "    pm2 restart discord-spotify-bot"
echo ""
echo "4️⃣  Check it's working:"
echo "    pm2 logs discord-spotify-bot"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "📋 Useful commands:"
echo "   pm2 logs discord-spotify-bot   - View logs"
echo "   pm2 restart discord-spotify-bot - Restart bot"
echo "   pm2 status                      - Check status"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "⚠️  NOTE: When using /login, your browser will show a security warning"
echo "    because of the self-signed certificate. Just click 'Advanced' and"
echo "    'Proceed' - this is safe since it's your own server."
