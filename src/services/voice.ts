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
import { Innertube } from 'youtubei.js';
import { spawn, execSync } from 'child_process';
import { spotifyService, CurrentlyPlaying } from './spotify';

// Find yt-dlp binary - check common locations
function getYtdlpPath(): string {
    const paths = [
        '/opt/homebrew/bin/yt-dlp',  // macOS Homebrew (Apple Silicon)
        '/usr/local/bin/yt-dlp',      // macOS Homebrew (Intel) / Linux
        '/usr/bin/yt-dlp',            // Linux package manager
        'yt-dlp'                       // System PATH
    ];
    
    for (const p of paths) {
        try {
            execSync(`${p} --version`, { stdio: 'ignore' });
            return p;
        } catch {}
    }
    
    return 'yt-dlp'; // Fallback to PATH
}

const ytdlpPath = getYtdlpPath();

// Initialize Innertube instance for search only
let innertube: Innertube | null = null;

async function getInnertube(): Promise<Innertube> {
    if (!innertube) {
        innertube = await Innertube.create();
    }
    return innertube;
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

            await entersState(connection, VoiceConnectionStatus.Ready, 30_000);

            const player = createAudioPlayer();
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
            return {
                success: false,
                message: 'Failed to connect to voice channel.',
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

        const currentlyPlaying = await spotifyService.getCurrentlyPlaying(
            session.controllingUserId
        );

        if (!currentlyPlaying) {
            // Nothing playing, stop if something is playing
            if (session.player.state.status !== AudioPlayerStatus.Idle) {
                session.player.stop();
                session.currentTrackUrl = null;
            }
            return;
        }

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
    }

    private async playTrack(guildId: string, track: CurrentlyPlaying): Promise<void> {
        const session = this.sessions.get(guildId);
        if (!session || !track.trackUrl) return;

        try {
            const yt = await getInnertube();
            
            // Search for the track on YouTube using youtubei.js
            const searchQuery = `${track.trackName} ${track.artistName} audio`;
            console.log(`Searching YouTube for: ${searchQuery}`);
            
            const searchResults = await yt.search(searchQuery, { type: 'video' });
            
            if (!searchResults.results || searchResults.results.length === 0) {
                console.log(`No YouTube results found for: ${searchQuery}`);
                return;
            }

            // Find the first video result
            const firstVideo = searchResults.results.find((r: any) => r.type === 'Video') as any;
            if (!firstVideo || !firstVideo.id) {
                console.log(`No video found in results for: ${searchQuery}`);
                return;
            }

            const videoUrl = `https://www.youtube.com/watch?v=${firstVideo.id}`;
            console.log(`Found YouTube video: ${firstVideo.title?.text} (${firstVideo.id})`);
            
            // Spawn yt-dlp process to stream audio directly
            const ytdlProcess = spawn(ytdlpPath, [
                '-f', 'bestaudio',
                '-o', '-',
                '--no-warnings',
                '--no-playlist',
                videoUrl
            ]);

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

            console.log(`Now playing: ${track.trackName} by ${track.artistName}`);
        } catch (error) {
            console.error('Error playing track:', error);
        }
    }

    getCurrentTrack(guildId: string): string | null {
        return this.sessions.get(guildId)?.currentTrackUrl ?? null;
    }
}

export const voiceManager = new VoiceManager();
