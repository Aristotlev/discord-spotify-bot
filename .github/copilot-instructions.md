<!-- Custom instructions for the Discord Spotify Bot project -->

## Project Overview
This is a Discord bot built with TypeScript that syncs Spotify playback to voice channels.

## Tech Stack
- **Runtime**: Node.js 18+
- **Language**: TypeScript
- **Discord Library**: discord.js v14
- **Voice**: @discordjs/voice
- **Spotify**: spotify-web-api-node
- **Audio Streaming**: play-dl (YouTube search for audio)
- **Web Server**: Express (OAuth callback)

## Project Structure
- `src/index.ts` - Main entry point, Discord client initialization
- `src/config.ts` - Environment variable configuration
- `src/commands/` - Slash command definitions
- `src/services/spotify.ts` - Spotify OAuth and API integration
- `src/services/voice.ts` - Voice channel management and audio playback
- `src/server/` - Express server for OAuth callbacks

## Key Concepts
- Only one user can control the bot per guild/server
- Bot polls Spotify API every 5 seconds to sync playback
- Audio is sourced from YouTube (using play-dl) based on track name search
- Users must authenticate with Spotify before using voice features

## Development Commands
- `npm run dev` - Run in development mode with ts-node
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run the compiled bot
- `npm run watch` - Watch mode for TypeScript compilation

## Environment Variables Required
- DISCORD_TOKEN
- DISCORD_CLIENT_ID  
- SPOTIFY_CLIENT_ID
- SPOTIFY_CLIENT_SECRET
- SPOTIFY_REDIRECT_URI
- PORT
