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
import { spotifyService, CurrentlyPlaying } from './spotify';
import play, { SoundCloudTrack, YouTubeStream, SoundCloudStream } from 'play-dl';

// Search YouTube using play-dl (primary source)
async function searchYouTube(query: string): Promise<{ url: string; source: 'youtube' } | null> {
    try {
        console.log(`[YouTube] Searching for: ${query}`);
        const results = await play.search(query, { 
            source: { youtube: 'video' },
            limit: 5  // Get more results in case first one fails
        });
        
        if (results.length > 0) {
            console.log(`[YouTube] Found ${results.length} results. First: ${results[0].title} - ${results[0].url}`);
            return { url: results[0].url, source: 'youtube' };
        }
        
        console.log(`[YouTube] No results for: ${query}`);
        return null;
    } catch (error: any) {
        console.error(`[YouTube] Search error: ${error.message || error}`);
        return null;
    }
}

// Search SoundCloud using play-dl (fallback source)
async function searchSoundCloud(query: string): Promise<{ url: string; source: 'soundcloud' } | null> {
    try {
        console.log(`[SoundCloud] Searching for: ${query}`);
        const results = await play.search(query, { 
            source: { soundcloud: 'tracks' },
            limit: 5
        });
        
        if (results.length > 0) {
            const track = results[0] as SoundCloudTrack;
            console.log(`[SoundCloud] Found: ${track.name} - ${track.url}`);
            return { url: track.url, source: 'soundcloud' };
        }
        
        console.log(`[SoundCloud] No results for: ${query}`);
        return null;
    } catch (error: any) {
        console.error(`[SoundCloud] Search error: ${error.message || error}`);
        return null;
    }
}

// Search for audio with multiple query variations
async function searchAudio(trackName: string, artistName: string): Promise<{ url: string; source: 'youtube' | 'soundcloud' } | null> {
    // Try different search queries in order of specificity
    const queries = [
        `${trackName} ${artistName} official audio`,
        `${trackName} ${artistName}`,
        `${trackName} ${artistName} lyrics`,
        `${trackName}`,
    ];
    
    // Try YouTube with each query
    for (const query of queries) {
        const youtubeResult = await searchYouTube(query);
        if (youtubeResult) {
            return youtubeResult;
        }
    }
    
    // Fallback to SoundCloud
    console.log('[Audio] YouTube failed for all queries, trying SoundCloud...');
    for (const query of queries.slice(0, 2)) { // Only try first 2 queries for SoundCloud
        const soundcloudResult = await searchSoundCloud(query);
        if (soundcloudResult) {
            return soundcloudResult;
        }
    }
    
    return null;
}

// Get audio stream from URL using play-dl
async function getAudioStream(url: string, source: 'youtube' | 'soundcloud'): Promise<YouTubeStream | SoundCloudStream | null> {
    try {
        console.log(`[Stream] Getting ${source} stream for: ${url}`);
        const stream = await play.stream(url);
        console.log(`[Stream] Created successfully: type=${stream.type}`);
        return stream;
    } catch (error: any) {
        console.error(`[Stream] Error getting ${source} stream: ${error.message || error}`);
        return null;
    }
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
            console.log(`[PlayTrack] Starting playback for: ${track.trackName} by ${track.artistName}`);
            
            // Search for the track - YouTube primary, SoundCloud fallback
            const audioResult = await searchAudio(track.trackName, track.artistName);
            
            if (!audioResult) {
                console.log(`[PlayTrack] No audio results found for: ${track.trackName} by ${track.artistName}`);
                return;
            }

            console.log(`[PlayTrack] Found on ${audioResult.source}: ${audioResult.url}`);
            
            // Get audio stream using play-dl
            const stream = await getAudioStream(audioResult.url, audioResult.source);
            
            if (!stream) {
                console.log(`[PlayTrack] Failed to get stream for: ${audioResult.url}`);
                return;
            }

            const resource = createAudioResource(stream.stream, {
                inputType: stream.type,
            });

            session.player.play(resource);
            session.currentTrackUrl = track.trackUrl;
            console.log(`[PlayTrack] Now playing (via ${audioResult.source}): ${track.trackName} by ${track.artistName}`);
        } catch (error: any) {
            console.error(`[PlayTrack] Error: ${error.message || error}`);
        }
    }

    getCurrentTrack(guildId: string): string | null {
        return this.sessions.get(guildId)?.currentTrackUrl ?? null;
    }
}

export const voiceManager = new VoiceManager();
