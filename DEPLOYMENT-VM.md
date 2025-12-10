# Deploying Discord Spotify Bot to Google Compute Engine VM

## Why VM instead of Cloud Run?
Discord voice requires **UDP connections** which Cloud Run doesn't support. A VM gives you full network access.

---

## Step 1: Create a VM (if you haven't already)

1. Go to [Google Compute Engine](https://console.cloud.google.com/compute/instances)
2. Click "Create Instance"
3. Settings:
   - **Name**: `discord-spotify-bot`
   - **Region**: Choose one close to you
   - **Machine type**: `e2-small` (2 vCPU, 2GB RAM) - minimum for audio processing
   - **Boot disk**: Ubuntu 22.04 LTS, 20GB
   - **Firewall**: ✅ Allow HTTP, ✅ Allow HTTPS
4. Click "Create"

---

## Step 2: Configure Firewall Rules

1. Go to [VPC Firewall Rules](https://console.cloud.google.com/networking/firewalls)
2. Click "Create Firewall Rule"
3. Create rule for OAuth callback:
   - **Name**: `allow-bot-oauth`
   - **Direction**: Ingress
   - **Targets**: All instances (or specific tag)
   - **Source IP ranges**: `0.0.0.0/0`
   - **Protocols and ports**: TCP: `8080`
4. Click "Create"

---

## Step 3: SSH into your VM

```bash
# Option 1: Use gcloud
gcloud compute ssh discord-spotify-bot --zone=YOUR_ZONE

# Option 2: Use the SSH button in GCP Console
```

---

## Step 4: Run the deployment script

```bash
# Download and run the deployment script
curl -fsSL https://raw.githubusercontent.com/Aristotlev/discord-spotify-bot/main/deploy-vm.sh | bash
```

Or manually:

```bash
# Clone the repo
git clone https://github.com/Aristotlev/discord-spotify-bot.git
cd discord-spotify-bot

# Make script executable and run
chmod +x deploy-vm.sh
./deploy-vm.sh
```

---

## Step 5: Set up environment variables

Create a `.env` file in the project directory:

```bash
cd ~/discord-spotify-bot

cat > .env << 'EOF'
DISCORD_TOKEN=your_discord_bot_token
DISCORD_CLIENT_ID=your_discord_client_id
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=https://YOUR_VM_EXTERNAL_IP:8080/callback
PORT=8080
EOF
```

Replace the values with your actual credentials.

**Get your VM's external IP:**
```bash
curl -s ifconfig.me
```

---

## Step 6: Set up SSL certificates (Required for Spotify OAuth)

Spotify requires HTTPS for OAuth callbacks. Options:

### Option A: Self-signed certificate (quick but shows browser warning)
```bash
mkdir -p certs
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout certs/key.pem \
  -out certs/cert.pem \
  -subj "/CN=YOUR_VM_IP"
```

### Option B: Let's Encrypt with a domain (recommended)
```bash
# Install certbot
sudo apt install certbot

# Get certificate (replace with your domain)
sudo certbot certonly --standalone -d bot.yourdomain.com

# Copy certs to project
mkdir -p certs
sudo cp /etc/letsencrypt/live/bot.yourdomain.com/fullchain.pem certs/cert.pem
sudo cp /etc/letsencrypt/live/bot.yourdomain.com/privkey.pem certs/key.pem
sudo chown $USER:$USER certs/*
```

### Option C: Use Cloudflare proxy
Point a domain to your VM and use Cloudflare's SSL.

---

## Step 7: Update Spotify Dashboard

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Select your app → Settings
3. Add Redirect URI: `https://YOUR_VM_IP:8080/callback` (or your domain)

---

## Step 8: Start the bot

```bash
cd ~/discord-spotify-bot

# Start with pm2
pm2 start dist/index.js --name discord-spotify-bot

# Check it's running
pm2 status

# View logs
pm2 logs discord-spotify-bot
```

---

## Step 9: Set up auto-restart on reboot

```bash
pm2 startup
# Run the command it outputs
pm2 save
```

---

## Useful Commands

```bash
# View logs
pm2 logs discord-spotify-bot

# Restart bot
pm2 restart discord-spotify-bot

# Stop bot
pm2 stop discord-spotify-bot

# Update and redeploy
cd ~/discord-spotify-bot
git pull origin main
npm ci
npm run build
pm2 restart discord-spotify-bot
```

---

## Troubleshooting

**Bot not connecting to voice?**
- Make sure UDP is allowed (GCP VMs allow this by default)
- Check logs: `pm2 logs discord-spotify-bot`

**OAuth callback not working?**
- Verify firewall allows TCP 8080
- Check SSL certs are in `./certs/` folder
- Verify redirect URI matches exactly in Spotify dashboard and `.env`

**Audio not playing?**
- Check ffmpeg is installed: `ffmpeg -version`
- Check yt-dlp is installed: `yt-dlp --version`
- Check logs for errors

**Bot crashes?**
- Check memory usage: `free -m`
- Upgrade to larger VM if needed
- Check logs: `pm2 logs discord-spotify-bot --lines 100`

---

## Costs

Google Compute Engine (e2-small, always running):
- **~$15-20/month** depending on region
- Free tier: 1 e2-micro instance per month (may not have enough RAM)
