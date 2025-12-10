# Deploying Discord Spotify Bot to Google Compute Engine VM

## Why VM instead of Cloud Run?
Discord voice requires **UDP connections** which Cloud Run doesn't support. A VM gives you full network access.

---

## Quick Start (3 steps)

### Step 1: Create a VM

1. Go to [Google Compute Engine](https://console.cloud.google.com/compute/instances)
2. Click "Create Instance"
3. Settings:
   - **Name**: `discord-spotify-bot`
   - **Region**: Choose one close to you
   - **Machine type**: `e2-small` (2 vCPU, 2GB RAM) - minimum for audio processing
   - **Boot disk**: Ubuntu 22.04 LTS, 20GB
   - **Firewall**: ✅ Allow HTTP, ✅ Allow HTTPS
4. Click "Create"

### Step 2: Open Port 8080

1. Go to [VPC Firewall Rules](https://console.cloud.google.com/networking/firewalls)
2. Click "Create Firewall Rule"
3. Settings:
   - **Name**: `allow-bot-oauth`
   - **Direction**: Ingress
   - **Targets**: All instances
   - **Source IP ranges**: `0.0.0.0/0`
   - **Protocols and ports**: TCP: `8080`
4. Click "Create"

### Step 3: SSH and Deploy

```bash
# SSH into your VM
gcloud compute ssh discord-spotify-bot --zone=YOUR_ZONE

# Download and run the deployment script
curl -fsSL https://raw.githubusercontent.com/Aristotlev/discord-spotify-bot/main/deploy-vm.sh | bash
```

The script will:
- ✅ Install Node.js, ffmpeg, yt-dlp, pm2
- ✅ Clone and build the bot
- ✅ Generate SSL certificates automatically
- ✅ Create a template .env file
- ✅ Start the bot with pm2

---

## After Deployment

### 1. Update Spotify Dashboard

The script will show you your VM's IP. Add this redirect URI in [Spotify Developer Dashboard](https://developer.spotify.com/dashboard):

```
https://YOUR_VM_IP:8080/callback
```

### 2. Edit your credentials

```bash
cd ~/discord-spotify-bot
nano .env
```

Fill in your actual tokens:
```
DISCORD_TOKEN=your_real_discord_token
DISCORD_CLIENT_ID=your_real_client_id
SPOTIFY_CLIENT_ID=your_real_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_real_spotify_secret
SPOTIFY_REDIRECT_URI=https://YOUR_VM_IP:8080/callback
PORT=8080
```

### 3. Restart the bot

```bash
pm2 restart discord-spotify-bot
pm2 logs discord-spotify-bot
```

---

## Using the Bot

1. In Discord, use `/login` - you'll get a Spotify auth link
2. Click the link, your browser may show a security warning (self-signed cert)
3. Click "Advanced" → "Proceed" to continue
4. Authorize with Spotify
5. Use `/connect` to join your voice channel
6. Play music on Spotify - the bot syncs it!

---

## Useful Commands

```bash
# View logs
pm2 logs discord-spotify-bot

# Restart bot
pm2 restart discord-spotify-bot

# Stop bot
pm2 stop discord-spotify-bot

# Check status
pm2 status

# Update to latest version
cd ~/discord-spotify-bot
git pull origin main
npm ci
npm run build
pm2 restart discord-spotify-bot
```

---

## Troubleshooting

**Bot stops after VM restarts?**
- SSH back into your VM and run:
  ```bash
  # Check if pm2 startup is configured
  pm2 startup
  
  # Run the command it outputs (starts with sudo...)
  sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u YOUR_USERNAME --hp /home/YOUR_USERNAME
  
  # Save current processes
  pm2 save
  
  # Verify the service is enabled
  sudo systemctl status pm2-YOUR_USERNAME
  sudo systemctl enable pm2-YOUR_USERNAME
  ```

**Bot not responding (application did not respond)?**
- First, check if the bot process is running:
  ```bash
  pm2 status
  pm2 logs discord-spotify-bot --lines 50
  ```
- If pm2 shows no processes, restart it:
  ```bash
  cd ~/discord-spotify-bot
  pm2 start dist/index.js --name discord-spotify-bot
  pm2 save
  ```

**OAuth callback not working?**
- Check firewall allows TCP 8080: `sudo ss -tlnp | grep 8080`
- Check the bot is running: `pm2 status`
- Verify redirect URI matches exactly in Spotify dashboard and `.env`

**Bot not connecting to voice?**
- Check logs: `pm2 logs discord-spotify-bot`
- UDP is allowed by default on GCP VMs

**Audio not playing?**
- Check ffmpeg: `ffmpeg -version`
- Check yt-dlp: `yt-dlp --version`

**Bot crashes?**
- Check memory: `free -m`
- View full logs: `pm2 logs discord-spotify-bot --lines 200`

---

## Costs

Google Compute Engine (e2-small, always running):
- **~$15-20/month** depending on region
- Free tier: 1 e2-micro instance (may not have enough RAM for audio)
