# Discord Spotify Bot

A Discord bot that syncs Spotify playback to voice channels. Users can connect their Spotify account and the bot will play whatever they're listening to in the voice channel.

## Features

- 🎵 **Spotify Integration**: Connect your Spotify account via OAuth
- 🔊 **Voice Channel Sync**: Bot plays your Spotify music in Discord voice channels
- 👤 **Single User Control**: Only one user can control the bot per server at a time
- 📊 **Now Playing**: See what's currently playing with album art and progress bar

## Prerequisites

- Node.js 18+ 
- A Discord Bot Token
- Spotify Developer Application credentials
- FFmpeg (usually bundled with ffmpeg-static)

## Setup

### 1. Discord Bot Setup

1. Go to [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application
3. Go to "Bot" section and create a bot
4. Copy the Bot Token
5. Enable these Privileged Gateway Intents:
   - Server Members Intent
   - Message Content Intent (optional)
6. Go to OAuth2 > URL Generator
7. Select scopes: `bot`, `applications.commands`
8. Select bot permissions: `Connect`, `Speak`, `Use Voice Activity`
9. Use the generated URL to invite the bot to your server

### 2. Spotify App Setup

1. Go to [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)
2. Create a new app
3. Set the Redirect URI to `http://localhost:3000/callback`
4. Copy the Client ID and Client Secret

### 3. Environment Configuration

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Fill in your credentials:
   ```env
   DISCORD_TOKEN=your_discord_bot_token
   DISCORD_CLIENT_ID=your_discord_client_id
   SPOTIFY_CLIENT_ID=your_spotify_client_id
   SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
   SPOTIFY_REDIRECT_URI=http://localhost:3000/callback
   PORT=3000
   ```

### 4. Install Dependencies

```bash
npm install
```

### 5. Build and Run

```bash
# Build TypeScript
npm run build

# Start the bot
npm start

# Or run in development mode
npm run dev
```

## Commands

| Command | Description |
|---------|-------------|
| `/spotify-login` | Connect your Spotify account to the bot |
| `/spotify-logout` | Disconnect your Spotify account |
| `/connect` | Connect the bot to your current voice channel |
| `/disconnect` | Disconnect the bot from the voice channel |
| `/now-playing` | Show what's currently playing |

## How It Works

1. User connects their Spotify account using `/spotify-login`
2. User joins a voice channel and uses `/connect`
3. Bot joins the voice channel and starts syncing
4. Bot polls Spotify API every 5 seconds to check what's playing
5. When a new track is detected, bot searches YouTube and plays the audio
6. Only one user can control the bot per server at a time

## Architecture

```
src/
├── index.ts           # Main entry point, Discord client setup
├── config.ts          # Environment configuration
├── commands/
│   └── index.ts       # Slash command definitions
├── services/
│   ├── spotify.ts     # Spotify OAuth and API handling
│   └── voice.ts       # Voice channel and audio playback
└── server/
    └── index.ts       # Express server for OAuth callback
```

## Limitations

- Audio is sourced from YouTube searches (not direct Spotify streaming)
- There may be slight delays between Spotify playback and Discord audio
- Requires the user to have an active Spotify session

## Troubleshooting

### Bot won't connect to voice channel
- Ensure the bot has `Connect` and `Speak` permissions
- Make sure you're in a voice channel when using `/connect`

### Spotify login fails
- Verify your Spotify app credentials in `.env`
- Check that the redirect URI matches exactly

### No audio playing
- Ensure FFmpeg is installed and accessible
- Check console for any playback errors

## License

MIT
