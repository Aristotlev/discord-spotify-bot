# Deploying Discord Spotify Bot to Google Cloud Run

## Prerequisites
- Google Cloud account with billing enabled
- GitHub repository with your bot code
- Cloudflare account (for domain/DNS)
- Domain name (optional but recommended for OAuth)

---

## Step 1: Push Code to GitHub

```bash
cd "Discord Spotify Bot"
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/discord-spotify-bot.git
git push -u origin main
```

---

## Step 2: Set Up Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com)

2. **Create a new project:**
   - Click the project dropdown → "New Project"
   - Name it `discord-spotify-bot`
   - Click "Create"

3. **Enable required APIs:**
   - Go to "APIs & Services" → "Enable APIs and Services"
   - Enable these APIs:
     - Cloud Run API
     - Cloud Build API
     - Container Registry API

4. **Enable billing** for your project (required for Cloud Run)

---

## Step 3: Connect GitHub to Cloud Build

1. Go to [Cloud Build Triggers](https://console.cloud.google.com/cloud-build/triggers)

2. Click **"Connect Repository"**

3. Select **GitHub** → Authenticate → Select your repository

4. Click **"Create a Trigger"**:
   - Name: `deploy-on-push`
   - Event: Push to a branch
   - Branch: `^main$`
   - Configuration: Cloud Build configuration file
   - Location: `cloudbuild.yaml`

5. Click **"Create"**

---

## Step 4: Set Environment Variables (Secrets)

1. Go to [Secret Manager](https://console.cloud.google.com/security/secret-manager)

2. Enable the Secret Manager API if prompted

3. Create secrets for each environment variable:
   - Click **"Create Secret"**
   - Create these secrets:
     - `DISCORD_TOKEN` → your Discord bot token
     - `DISCORD_CLIENT_ID` → your Discord client ID
     - `SPOTIFY_CLIENT_ID` → your Spotify client ID
     - `SPOTIFY_CLIENT_SECRET` → your Spotify client secret
     - `SPOTIFY_REDIRECT_URI` → `https://your-domain.com/callback` (or Cloud Run URL)

4. **Grant Cloud Run access to secrets:**
   - Go to IAM & Admin → IAM
   - Find the Cloud Run service account (ends with `@run.app`)
   - Add role: `Secret Manager Secret Accessor`

5. **Update Cloud Run to use secrets:**
   After first deployment, go to Cloud Run → your service → Edit & Deploy New Revision → Variables & Secrets → Add each secret as an environment variable.

---

## Step 5: Set Up Cloudflare (Optional - for custom domain)

1. **Add your domain to Cloudflare** (if not already)

2. **Get your Cloud Run URL:**
   - After deployment, go to Cloud Run → your service
   - Copy the URL (e.g., `https://discord-spotify-bot-xxxxx-uc.a.run.app`)

3. **Create a CNAME record:**
   - Type: CNAME
   - Name: `bot` (or whatever subdomain you want)
   - Target: `ghs.googlehosted.com`

4. **Map custom domain in Cloud Run:**
   - Go to Cloud Run → Manage Custom Domains
   - Add mapping → Select your service
   - Enter your domain: `bot.yourdomain.com`
   - Follow verification steps

5. **Update Spotify redirect URI:**
   - Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
   - Edit your app → Settings
   - Add redirect URI: `https://bot.yourdomain.com/callback`

---

## Step 6: Deploy!

**Option A: Automatic (push to GitHub)**
```bash
git add .
git commit -m "Deploy to Cloud Run"
git push origin main
```

**Option B: Manual (first time)**
```bash
# Install Google Cloud SDK if not installed
# https://cloud.google.com/sdk/docs/install

gcloud auth login
gcloud config set project YOUR_PROJECT_ID

# Build and deploy manually
gcloud builds submit --config cloudbuild.yaml
```

---

## Step 7: Configure Environment Variables in Cloud Run

After the first deployment:

1. Go to [Cloud Run](https://console.cloud.google.com/run)
2. Click on your service `discord-spotify-bot`
3. Click **"Edit & Deploy New Revision"**
4. Go to **"Variables & Secrets"** tab
5. Add environment variables:
   - `DISCORD_TOKEN` → Reference from Secret Manager
   - `DISCORD_CLIENT_ID` → Your Discord client ID
   - `SPOTIFY_CLIENT_ID` → Your Spotify client ID
   - `SPOTIFY_CLIENT_SECRET` → Reference from Secret Manager
   - `SPOTIFY_REDIRECT_URI` → Your callback URL
   - `PORT` → 8080
6. Click **"Deploy"**

---

## Step 8: Update Discord Bot Settings

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Select your application
3. Go to **OAuth2** → **General**
4. Add redirect: `https://your-cloud-run-url.run.app/callback`

---

## Monitoring & Logs

- **View logs:** Cloud Run → Your service → Logs
- **Monitor:** Cloud Run → Your service → Metrics

---

## Troubleshooting

**Bot not staying online?**
- Cloud Run scales to zero by default. We set `--min-instances 1` to keep it running.

**OAuth callback not working?**
- Make sure `SPOTIFY_REDIRECT_URI` matches exactly in:
  - Your `.env` / Cloud Run environment variables
  - Spotify Developer Dashboard

**Audio not playing?**
- Check logs for yt-dlp errors
- Make sure ffmpeg is installed (it's in the Dockerfile)

---

## Costs

Google Cloud Run pricing (approximate):
- **Free tier:** 2 million requests/month, 360,000 GB-seconds
- **With min-instances=1:** ~$15-25/month (always-on)

To reduce costs, you can set `--min-instances 0` but the bot will have cold starts.
