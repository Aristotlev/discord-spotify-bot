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

// Enhanced yt-dlp args to bypass bot detection - updated for latest YouTube changes
const YTDLP_COMMON_ARGS = [
    '--no-warnings',
    '--no-check-certificates',
    '--geo-bypass',
    '--extractor-args', 'youtube:player_client=ios,web',
    '--user-agent', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
];

// Search YouTube using yt-dlp with improved error handling
async function searchYouTube(query: string): Promise<string | null> {
    return new Promise((resolve) => {
        const escapedQuery = query.replace(/"/g, '\\"');
        console.log('[YouTube] Searching for: ' + query);
        
        // Use spawn instead of execSync for better error handling
        const args = [
            ...YTDLP_COMMON_ARGS,
            '--flat-playlist',
            '--print', 'url',
            `ytsearch1:${escapedQuery}`
        ];
        
        console.log('[YouTube] Running: yt-dlp ' + args.join(' '));
        
        const proc = spawn(ytdlpPath, args, { 
            timeout: 30000,
            stdio: ['ignore', 'pipe', 'pipe']
        });
        
        let stdout = '';
        let stderr = '';
        
        proc.stdout.on('data', (data) => {
            stdout += data.toString();
        });
        
        proc.stderr.on('data', (data) => {
            stderr += data.toString();
        });
        
        proc.on('error', (error) => {
            console.error('[YouTube] Process error: ' + error.message);
            resolve(null);
        });
        
        proc.on('close', (code) => {
            if (stderr) {
                console.log('[YouTube] stderr: ' + stderr.substring(0, 500));
            }
            
            const result = stdout.trim();
            if (code === 0 && result && result.startsWith('http')) {
                console.log('[YouTube] Found: ' + result);
                resolve(result);
            } else {
                console.log('[YouTube] Search failed with code ' + code + ', output: ' + result.substring(0, 200));
                resolve(null);
            }
        });
        
        // Timeout handler
        setTimeout(() => {
            if (!proc.killed) {
                console.log('[YouTube] Search timeout, killing process');
                proc.kill('SIGKILL');
                resolve(null);
            }
        }, 25000);
    });
}

// Get direct audio URL from YouTube using yt-dlp with improved bypass
async function getYouTubeAudioUrl(videoUrl: string): Promise<string | null> {
    return new Promise((resolve) => {
        console.log('[YouTube] Getting audio URL for: ' + videoUrl);
        
        // Try multiple format combinations
        const formatPriority = [
            'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
            '140',  // m4a audio
            '251',  // webm opus
            '250',  // webm opus lower quality
            '249',  // webm opus lowest
        ];
        
        let currentIndex = 0;
        
        const tryFormat = () => {
            if (currentIndex >= formatPriority.length) {
                console.log('[YouTube] Failed to get audio URL with any format');
                resolve(null);
                return;
            }
            
            const fmt = formatPriority[currentIndex];
            console.log('[YouTube] Trying format: ' + fmt);
            
            const args = [
                ...YTDLP_COMMON_ARGS,
                '-f', fmt,
                '--get-url',
                videoUrl
            ];
            
            const proc = spawn(ytdlpPath, args, {
                timeout: 30000,
                stdio: ['ignore', 'pipe', 'pipe']
            });
            
            let stdout = '';
            let stderr = '';
            
            proc.stdout.on('data', (data) => {
                stdout += data.toString();
            });
            
            proc.stderr.on('data', (data) => {
                stderr += data.toString();
            });
            
            proc.on('error', (error) => {
                console.error('[YouTube] Format ' + fmt + ' process error: ' + error.message);
                currentIndex++;
                tryFormat();
            });
            
            proc.on('close', (code) => {
                const result = stdout.trim();
                if (code === 0 && result && result.startsWith('http')) {
                    console.log('[YouTube] Got audio URL with format: ' + fmt);
                    resolve(result);
                } else {
                    if (stderr) {
                        console.log('[YouTube] Format ' + fmt + ' stderr: ' + stderr.substring(0, 200));
                    }
                    console.log('[YouTube] Format ' + fmt + ' failed, trying next...');
                    currentIndex++;
                    tryFormat();
                }
            });
            
            // Timeout for this format attempt
            setTimeout(() => {
                if (!proc.killed) {
                    console.log('[YouTube] Format ' + fmt + ' timeout');
                    proc.kill('SIGKILL');
                    currentIndex++;
                    tryFormat();
                }
            }, 20000);
        };
        
        tryFormat();
    });
}

// Stream audio using ffmpeg from a direct URL
function createFfmpegStream(audioUrl: string): ChildProcess {
    console.log('[FFmpeg] Creating stream from URL...');
    
    const ffmpegProcess = spawn('ffmpeg', [
        '-reconnect', '1',
        '-reconnect_streamed', '1', 
        '-reconnect_delay_max', '5',
        '-user_agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        '-i', audioUrl,
        '-analyzeduration', '0',
        '-loglevel', 'info',
        '-vn',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-'
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        const msg = data.toString();
        // Log all ffmpeg output for debugging
        console.log('[FFmpeg] ' + msg.trim());
    });

    ffmpegProcess.on('error', (error) => {
        console.error('[FFmpeg] Process error: ' + error.message);
    });

    ffmpegProcess.on('close', (code) => {
        console.log('[FFmpeg] Process closed with code: ' + code);
    });

    return ffmpegProcess;
}

// Alternative: Stream directly using yt-dlp piped to ffmpeg
function createYtdlpStream(videoUrl: string): ChildProcess {
    console.log('[yt-dlp+FFmpeg] Creating piped stream for: ' + videoUrl);
    
    // Use yt-dlp to download audio and pipe directly to ffmpeg
    const ytdlpProcess = spawn(ytdlpPath, [
        ...YTDLP_COMMON_ARGS,
        '-f', 'bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best',
        '-o', '-',  // Output to stdout
        videoUrl
    ], { stdio: ['ignore', 'pipe', 'pipe'] });

    ytdlpProcess.stderr?.on('data', (data: Buffer) => {
        console.log('[yt-dlp pipe] ' + data.toString().trim());
    });

    // Pipe yt-dlp output to ffmpeg
    const ffmpegProcess = spawn('ffmpeg', [
        '-i', 'pipe:0',  // Read from stdin
        '-analyzeduration', '0',
        '-loglevel', 'info',
        '-vn',
        '-f', 's16le',
        '-ar', '48000',
        '-ac', '2',
        '-'
    ], { stdio: ['pipe', 'pipe', 'pipe'] });

    // Pipe yt-dlp stdout to ffmpeg stdin
    ytdlpProcess.stdout?.pipe(ffmpegProcess.stdin!);

    ffmpegProcess.stderr?.on('data', (data: Buffer) => {
        console.log('[FFmpeg pipe] ' + data.toString().trim());
    });

    ytdlpProcess.on('error', (error) => {
        console.error('[yt-dlp pipe] Process error: ' + error.message);
    });

    ytdlpProcess.on('close', (code) => {
        console.log('[yt-dlp pipe] Process closed with code: ' + code);
    });

    ffmpegProcess.on('error', (error) => {
        console.error('[FFmpeg pipe] Process error: ' + error.message);
    });

    ffmpegProcess.on('close', (code) => {
        console.log('[FFmpeg pipe] Process closed with code: ' + code);
    });

    // Return ffmpeg process (the one with the audio output)
    // But attach ytdlp process for cleanup
    (ffmpegProcess as any).ytdlpProcess = ytdlpProcess;
    
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
            // Also kill the yt-dlp process if it exists
            if ((session.currentProcess as any).ytdlpProcess) {
                (session.currentProcess as any).ytdlpProcess.kill('SIGKILL');
            }
            session.currentProcess.kill('SIGKILL');
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
            console.log('[PlayTrack] ====================================');
            console.log('[PlayTrack] Starting: ' + track.trackName + ' by ' + track.artistName);
            console.log('[PlayTrack] Spotify URL: ' + track.trackUrl);
            
            // Kill previous processes if any
            if (session.currentProcess) {
                console.log('[PlayTrack] Killing previous process');
                // Also kill the yt-dlp process if it exists
                if ((session.currentProcess as any).ytdlpProcess) {
                    (session.currentProcess as any).ytdlpProcess.kill('SIGKILL');
                }
                session.currentProcess.kill('SIGKILL');
                session.currentProcess = null;
            }
            
            // Stop current player
            session.player.stop(true);
            
            // Search queries in order of preference
            const queries = [
                track.trackName + ' ' + track.artistName + ' audio',
                track.trackName + ' ' + track.artistName + ' official audio',
                track.trackName + ' ' + track.artistName,
                track.trackName + ' ' + track.artistName + ' lyrics',
            ];
            
            // Find YouTube video
            let videoUrl: string | null = null;
            for (const query of queries) {
                console.log('[PlayTrack] Trying search query: ' + query);
                videoUrl = await searchYouTube(query);
                if (videoUrl) {
                    console.log('[PlayTrack] Found video: ' + videoUrl);
                    break;
                }
            }
            
            if (!videoUrl) {
                console.error('[PlayTrack] ❌ No YouTube results for: ' + track.trackName);
                console.log('[PlayTrack] ====================================');
                return;
            }
            
            // Try direct piped streaming first (more reliable)
            console.log('[PlayTrack] Using piped yt-dlp+ffmpeg stream...');
            const streamProcess = createYtdlpStream(videoUrl);
            session.currentProcess = streamProcess;
            
            // Handle process errors
            if (!streamProcess.stdout) {
                console.error('[PlayTrack] ❌ Stream stdout is null');
                console.log('[PlayTrack] ====================================');
                return;
            }
            
            // Create audio resource
            console.log('[PlayTrack] Creating audio resource...');
            const resource = createAudioResource(streamProcess.stdout, {
                inputType: StreamType.Raw,
                inlineVolume: true,
            });
            
            // Set volume to 100%
            if (resource.volume) {
                resource.volume.setVolume(1);
            }

            console.log('[PlayTrack] ✅ Playing audio resource...');
            session.player.play(resource);
            session.currentTrackUrl = track.trackUrl;
            console.log('[PlayTrack] ✅ Now playing: ' + track.trackName);
            console.log('[PlayTrack] ====================================');
            
        } catch (error: any) {
            console.error('[PlayTrack] ❌ Error: ' + (error.message || error));
            console.error('[PlayTrack] Stack:', error.stack);
            console.log('[PlayTrack] ====================================');
        }
    }

    getCurrentTrack(guildId: string): string | null {
        return this.sessions.get(guildId)?.currentTrackUrl ?? null;
    }
}

export const voiceManager = new VoiceManager();
