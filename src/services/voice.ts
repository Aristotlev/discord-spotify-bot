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
import { spawn, execSync, ChildProcess } from 'child_process';
import { spotifyService, CurrentlyPlaying } from './spotify';

// Find yt-dlp binary path
function getYtdlpPath(): string {
    const paths = [
        '/usr/local/bin/yt-dlp',
        '/opt/homebrew/bin/yt-dlp',
        '/usr/bin/yt-dlp',
        'yt-dlp'
    ];
    
    for (const p of paths) {
        try {
            execSync(p + ' --version', { stdio: 'ignore' });
            console.log('[yt-dlp] Found at: ' + p);
            return p;
        } catch {}
    }
    
    console.log('[yt-dlp] Not found in common paths, using PATH');
    return 'yt-dlp';
}

const ytdlpPath = getYtdlpPath();

// Search YouTube using yt-dlp
async function searchYouTube(query: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            console.log('[YouTube] Searching for: ' + query);
            const cmd = ytdlpPath + ' --no-warnings --flat-playlist --print url "ytsearch1:' + query + '"';
            const result = execSync(cmd, { encoding: 'utf-8', timeout: 15000 }).trim();
            
            if (result && result.startsWith('http')) {
                console.log('[YouTube] Found: ' + result);
                resolve(result);
            } else {
                console.log('[YouTube] No results');
                resolve(null);
            }
        } catch (error: any) {
            console.error('[YouTube] Search error: ' + (error.message || error));
            resolve(null);
        }
    });
}

// Get direct audio URL from YouTube using yt-dlp
async function getYouTubeAudioUrl(videoUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
        try {
            console.log('[YouTube] Getting audio URL for: ' + videoUrl);
            // Use extractor-args to bypass bot detection and specify audio format
            const cmd = ytdlpPath + ' -f bestaudio --get-url --extractor-args "youtube:player_client=ios,web" "' + videoUrl + '"';
            const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 }).trim();
            
            if (result && result.startsWith('http')) {
                console.log('[YouTube] Got audio URL');
                resolve(result);
            } else {
                console.log('[YouTube] Failed to get audio URL');
                resolve(null);
            }
        } catch (error: any) {
            console.error('[YouTube] Audio URL error: ' + (error.message || error));
            resolve(null);
        }
    });
}

// Stream audio using ffmpeg from a direct URL
function createFfmpegStream(audioUrl: string): ChildProcess {
    console.log('[FFmpeg] Creating stream...');
    
    const ffmpegProcess = spawn('ffmpeg', [
        '-reconnect', '1',
        '-reconnect_streamed', '1',
        '-reconnect_delay_max', '5',
        '-i', audioUrl,
        '-analyzeduration', '0',
        '-loglevel', '0',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        'pipe:1'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString();
        if (msg.includes('Error') || msg.includes('error')) {
            console.error('[FFmpeg] ' + msg);
        }
    });

    ffmpegProcess.on('error', (error) => {
        console.error('[FFmpeg] Process error: ' + error.message);
    });

    return ffmpegProcess;
}

interface VoiceSession {
    connection: VoiceConnection;
    player: AudioPlayer;
    guildId: string;
    channelId: string;
    controllingUserId: string;
    pollingInterval: NodeJS.Timeout | null;
    currentTrackUrl: string | null;
    currentProcess: ChildProcess | null;
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
                currentProcess: null,
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
        if (session.currentProcess) {
            session.currentProcess.kill();
        }
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
                    if (session.currentProcess) {
                        session.currentProcess.kill();
                        session.currentProcess = null;
                    }
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
            console.log('[PlayTrack] Starting: ' + track.trackName + ' by ' + track.artistName);
            
            // Kill previous ffmpeg process if any
            if (session.currentProcess) {
                session.currentProcess.kill();
                session.currentProcess = null;
            }
            
            // Search queries in order of preference
            const queries = [
                track.trackName + ' ' + track.artistName + ' official audio',
                track.trackName + ' ' + track.artistName,
                track.trackName + ' audio',
            ];
            
            // Find YouTube video
            let videoUrl: string | null = null;
            for (const query of queries) {
                videoUrl = await searchYouTube(query);
                if (videoUrl) break;
            }
            
            if (!videoUrl) {
                console.log('[PlayTrack] No YouTube results for: ' + track.trackName);
                return;
            }
            
            // Get direct audio URL
            const audioUrl = await getYouTubeAudioUrl(videoUrl);
            if (!audioUrl) {
                console.log('[PlayTrack] Failed to get audio URL');
                return;
            }
            
            // Create ffmpeg stream
            const ffmpegProcess = createFfmpegStream(audioUrl);
            session.currentProcess = ffmpegProcess;
            
            const resource = createAudioResource(ffmpegProcess.stdout!, {
                inputType: StreamType.Raw,
            });

            session.player.play(resource);
            session.currentTrackUrl = track.trackUrl;
            console.log('[PlayTrack] Now playing: ' + track.trackName);
            
        } catch (error: any) {
            console.error('[PlayTrack] Error: ' + (error.message || error));
        }
    }

    getCurrentTrack(guildId: string): string | null {
        return this.sessions.get(guildId)?.currentTrackUrl ?? null;
    }
}

export const voiceManager = new VoiceManager();
