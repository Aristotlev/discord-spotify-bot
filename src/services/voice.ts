import {
    AudioPlayer,
    AudioPlayerStatus,
    VoiceConnection,
    createAudioPlayer,
    createAudioResource,
    joinVoiceChannel,
    entersState,
    VoiceConnectionStatus,
    StreamType,
} from '@discordjs/voice';
import { VoiceBasedChannel, GuildMember } from 'discord.js';
import { spawn, execSync } from 'child_process';
import { spotifyService, CurrentlyPlaying } from './spotify';
import ffmpegPath from 'ffmpeg-static';

// Set ffmpeg path for prism-media (used by @discordjs/voice)
if (ffmpegPath) {
    process.env.FFMPEG_PATH = ffmpegPath;
}

// Find yt-dlp binary - check common locations
function getYtdlpPath(): string {
    const paths = [
        '/usr/local/bin/yt-dlp',      // Docker/Linux
        '/opt/homebrew/bin/yt-dlp',   // macOS Homebrew (Apple Silicon)
        '/usr/bin/yt-dlp',            // Linux package manager
        'yt-dlp'                       // System PATH
    ];
    
    for (const p of paths) {
        try {
            execSync(`${p} --version`, { stdio: 'ignore' });
            console.log(`Found yt-dlp at: ${p}`);
            return p;
        } catch {}
    }
    
    console.log('yt-dlp not found in common paths, using PATH');
    return 'yt-dlp'; // Fallback to PATH
}

const ytdlpPath = getYtdlpPath();

// List of Piped instances to try (more reliable than Invidious)
const PIPED_INSTANCES = [
    'https://pipedapi.kavin.rocks',
    'https://pipedapi.adminforge.de',
    'https://api.piped.yt',
    'https://pipedapi.in.projectsegfau.lt',
];

// Search YouTube using yt-dlp and return the video URL
async function searchYouTube(query: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            // Use yt-dlp to search YouTube and get the first result's URL
            const result = execSync(
                `${ytdlpPath} --no-warnings --flat-playlist --print url "ytsearch1:${query}"`,
                { encoding: 'utf-8', timeout: 15000 }
            ).trim();
            
            if (result && result.startsWith('http')) {
                console.log(`YouTube search found: ${result}`);
                resolve(result);
            } else {
                console.log(`YouTube search returned no results for: ${query}`);
                resolve(null);
            }
        } catch (error) {
            console.error('YouTube search error:', error);
            resolve(null);
        }
    });
}

// Get audio stream URL from Piped API (more reliable than Invidious)
async function getAudioFromPiped(videoId: string): Promise<string | null> {
    for (const instance of PIPED_INSTANCES) {
        try {
            console.log(`Trying Piped instance: ${instance}`);
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 10000);
            
            const response = await fetch(`${instance}/streams/${videoId}`, {
                signal: controller.signal,
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                }
            });
            clearTimeout(timeoutId);
            
            if (!response.ok) {
                console.log(`Piped ${instance} returned ${response.status}`);
                continue;
            }
            
            const data = await response.json() as any;
            
            // Get audio streams
            const audioStreams = data.audioStreams || [];
            
            if (audioStreams.length > 0) {
                // Sort by bitrate and get highest quality audio
                audioStreams.sort((a: any, b: any) => (b.bitrate || 0) - (a.bitrate || 0));
                const audioUrl = audioStreams[0].url;
                console.log(`Got audio from Piped (${instance}): bitrate ${audioStreams[0].bitrate}`);
                return audioUrl;
            }
        } catch (error: any) {
            console.log(`Piped instance ${instance} failed: ${error.message}`);
        }
    }
    return null;
}

// Extract video ID from YouTube URL
function extractVideoId(url: string): string | null {
    const match = url.match(/(?:v=|\/)([\w-]{11})(?:\?|&|$)/);
    return match ? match[1] : null;
}

interface VoiceSession {
    connection: VoiceConnection;
    player: AudioPlayer;
    guildId: string;
    channelId: string;
    controllingUserId: string;
    pollingInterval: NodeJS.Timeout | null;
    currentTrackUrl: string | null;
}

class VoiceManager {
    private sessions: Map<string, VoiceSession> = new Map(); // guildId -> session

    async connectToChannel(
        channel: VoiceBasedChannel,
        member: GuildMember
    ): Promise<{ success: boolean; message: string }> {
        const guildId = channel.guild.id;
        const existingSession = this.sessions.get(guildId);

        // Check if someone else is already controlling
        if (existingSession && existingSession.controllingUserId !== member.id) {
            return {
                success: false,
                message: `<@${existingSession.controllingUserId}> is already controlling the bot in this server.`,
            };
        }

        // Check if user has Spotify connected
        if (!spotifyService.isUserConnected(member.id)) {
            return {
                success: false,
                message: 'You need to connect your Spotify account first! Use `/spotify-login`',
            };
        }

        try {
            const connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: guildId,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfDeaf: false,
                selfMute: false,
            });

            // Add connection state change logging
            connection.on('stateChange', (oldState, newState) => {
                console.log(`Voice connection state: ${oldState.status} -> ${newState.status}`);
            });

            connection.on('error', (error) => {
                console.error('Voice connection error:', error);
            });

            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

            const player = createAudioPlayer();
            
            // Add player state change logging
            player.on('stateChange', (oldState, newState) => {
                console.log(`Audio player state: ${oldState.status} -> ${newState.status}`);
            });

            player.on('error', (error) => {
                console.error('Audio player error:', error);
            });

            connection.subscribe(player);

            const session: VoiceSession = {
                connection,
                player,
                guildId,
                channelId: channel.id,
                controllingUserId: member.id,
                pollingInterval: null,
                currentTrackUrl: null,
            };

            this.sessions.set(guildId, session);
            this.startSpotifyPolling(guildId);

            return {
                success: true,
                message: `Connected to ${channel.name}! Your Spotify playback will now be synced.`,
            };
        } catch (error) {
            console.error('Error connecting to voice channel:', error);
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            return {
                success: false,
                message: `Failed to connect to voice channel: ${errorMessage}`,
            };
        }
    }

    disconnect(guildId: string): { success: boolean; message: string } {
        const session = this.sessions.get(guildId);
        
        if (!session) {
            return {
                success: false,
                message: 'Bot is not connected to any voice channel.',
            };
        }

        this.stopSpotifyPolling(guildId);
        session.player.stop();
        session.connection.destroy();
        this.sessions.delete(guildId);

        return {
            success: true,
            message: 'Disconnected from voice channel.',
        };
    }

    isUserControlling(guildId: string, userId: string): boolean {
        const session = this.sessions.get(guildId);
        return session?.controllingUserId === userId;
    }

    getSession(guildId: string): VoiceSession | undefined {
        return this.sessions.get(guildId);
    }

    private startSpotifyPolling(guildId: string): void {
        const session = this.sessions.get(guildId);
        if (!session) return;

        // Poll every 5 seconds
        session.pollingInterval = setInterval(async () => {
            await this.syncSpotifyPlayback(guildId);
        }, 5000);

        // Initial sync
        this.syncSpotifyPlayback(guildId);
    }

    private stopSpotifyPolling(guildId: string): void {
        const session = this.sessions.get(guildId);
        if (session?.pollingInterval) {
            clearInterval(session.pollingInterval);
            session.pollingInterval = null;
        }
    }

    private async syncSpotifyPlayback(guildId: string): Promise<void> {
        const session = this.sessions.get(guildId);
        if (!session) return;

        try {
            const currentlyPlaying = await spotifyService.getCurrentlyPlaying(
                session.controllingUserId
            );

            if (!currentlyPlaying) {
                // Nothing playing, stop if something is playing
                if (session.player.state.status !== AudioPlayerStatus.Idle) {
                    console.log('Spotify: Nothing playing, stopping audio');
                    session.player.stop();
                    session.currentTrackUrl = null;
                }
                return;
            }
            
            console.log(`Spotify sync: ${currentlyPlaying.trackName} - Playing: ${currentlyPlaying.isPlaying}`);

            if (!currentlyPlaying.isPlaying) {
                // Paused on Spotify
                if (session.player.state.status === AudioPlayerStatus.Playing) {
                    session.player.pause();
                }
                return;
            }

            // If playing and it's a different track, play it
            if (currentlyPlaying.trackUrl && currentlyPlaying.trackUrl !== session.currentTrackUrl) {
                await this.playTrack(guildId, currentlyPlaying);
            } else if (session.player.state.status === AudioPlayerStatus.Paused) {
                // Resume if was paused
                session.player.unpause();
            }
        } catch (error) {
            console.error('Error syncing Spotify playback:', error);
        }
    }

    private async playTrack(guildId: string, track: CurrentlyPlaying): Promise<void> {
        const session = this.sessions.get(guildId);
        if (!session || !track.trackUrl) return;

        try {
            // Search for the track on YouTube using yt-dlp
            const searchQuery = `${track.trackName} ${track.artistName} audio`;
            console.log(`Searching YouTube for: ${searchQuery}`);
            
            const videoUrl = await searchYouTube(searchQuery);
            
            if (!videoUrl) {
                console.log(`No YouTube results found for: ${searchQuery}`);
                return;
            }

            const videoId = extractVideoId(videoUrl);
            console.log(`Found YouTube video: ${videoUrl} (ID: ${videoId})`);
            
            // Try to get audio URL from Piped first (bypasses YouTube bot detection)
            let audioUrl: string | null = null;
            if (videoId) {
                audioUrl = await getAudioFromPiped(videoId);
            }

            if (audioUrl) {
                // Stream directly from Piped audio URL using ffmpeg
                console.log('Streaming from Piped...');
                const ffmpegProcess = spawn(ffmpegPath || 'ffmpeg', [
                    '-i', audioUrl,
                    '-f', 's16le',
                    '-ar', '48000',
                    '-ac', '2',
                    'pipe:1'
                ], { stdio: ['ignore', 'pipe', 'pipe'] });

                ffmpegProcess.stderr.on('data', (data) => {
                    // Only log errors, not progress
                    const msg = data.toString();
                    if (msg.includes('Error') || msg.includes('error')) {
                        console.log(`ffmpeg: ${msg}`);
                    }
                });

                const resource = createAudioResource(ffmpegProcess.stdout, {
                    inputType: StreamType.Raw,
                });

                session.player.play(resource);
                session.currentTrackUrl = track.trackUrl;
                console.log(`Now playing (via Invidious): ${track.trackName} by ${track.artistName}`);
            } else {
                // Fallback to yt-dlp (may fail with bot detection)
                console.log('Invidious failed, trying yt-dlp directly...');
                
                const ytdlpArgs = [
                    '-f', 'bestaudio',
                    '-o', '-',
                    '--no-warnings',
                    '--no-playlist',
                    '--extractor-args', 'youtube:player_client=android',
                ];
                
                if (ffmpegPath) {
                    ytdlpArgs.push('--ffmpeg-location', ffmpegPath);
                }
                
                ytdlpArgs.push(videoUrl);
                
                const ytdlProcess = spawn(ytdlpPath, ytdlpArgs);

                ytdlProcess.stderr.on('data', (data) => {
                    console.log(`yt-dlp: ${data.toString()}`);
                });

                ytdlProcess.on('error', (error) => {
                    console.error('yt-dlp process error:', error);
                });

                const resource = createAudioResource(ytdlProcess.stdout, {
                    inputType: StreamType.Arbitrary,
                });

                session.player.play(resource);
                session.currentTrackUrl = track.trackUrl;
                console.log(`Now playing (via yt-dlp): ${track.trackName} by ${track.artistName}`);
            }
        } catch (error) {
            console.error('Error playing track:', error);
        }
    }

    getCurrentTrack(guildId: string): string | null {
        return this.sessions.get(guildId)?.currentTrackUrl ?? null;
    }
}

export const voiceManager = new VoiceManager();
