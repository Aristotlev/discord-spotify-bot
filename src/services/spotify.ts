import SpotifyWebApi from 'spotify-web-api-node';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

const TOKENS_FILE = path.join(process.cwd(), 'spotify-tokens.json');

export interface SpotifyUserSession {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
    userId: string;
}

export interface CurrentlyPlaying {
    trackName: string;
    artistName: string;
    albumName: string;
    isPlaying: boolean;
    progressMs: number;
    durationMs: number;
    trackUrl: string | null;
    albumArtUrl: string | null;
}

class SpotifyService {
    private userSessions: Map<string, SpotifyUserSession> = new Map();
    private pendingAuths: Map<string, string> = new Map(); // state -> discordUserId

    constructor() {
        this.loadTokensFromFile();
    }

    private loadTokensFromFile(): void {
        try {
            if (fs.existsSync(TOKENS_FILE)) {
                const data = fs.readFileSync(TOKENS_FILE, 'utf-8');
                const tokens: Record<string, SpotifyUserSession> = JSON.parse(data);
                
                for (const [userId, session] of Object.entries(tokens)) {
                    this.userSessions.set(userId, session);
                }
                
                console.log(`✅ Loaded ${this.userSessions.size} Spotify session(s) from storage`);
            }
        } catch (error) {
            console.error('Error loading tokens from file:', error);
        }
    }

    private saveTokensToFile(): void {
        try {
            const tokens: Record<string, SpotifyUserSession> = {};
            
            for (const [userId, session] of this.userSessions.entries()) {
                tokens[userId] = session;
            }
            
            fs.writeFileSync(TOKENS_FILE, JSON.stringify(tokens, null, 2));
        } catch (error) {
            console.error('Error saving tokens to file:', error);
        }
    }

    createSpotifyApi(): SpotifyWebApi {
        return new SpotifyWebApi({
            clientId: config.spotify.clientId,
            clientSecret: config.spotify.clientSecret,
            redirectUri: config.spotify.redirectUri,
        });
    }

    getAuthUrl(discordUserId: string): string {
        const spotifyApi = this.createSpotifyApi();
        const state = this.generateState();
        this.pendingAuths.set(state, discordUserId);

        const scopes = [
            'user-read-playback-state',
            'user-read-currently-playing',
            'user-read-email',
            'user-read-private',
        ];

        return spotifyApi.createAuthorizeURL(scopes, state);
    }

    private generateState(): string {
        return Math.random().toString(36).substring(2, 15) + 
               Math.random().toString(36).substring(2, 15);
    }

    async handleCallback(code: string, state: string): Promise<string | null> {
        const discordUserId = this.pendingAuths.get(state);
        if (!discordUserId) {
            return null;
        }

        this.pendingAuths.delete(state);
        const spotifyApi = this.createSpotifyApi();

        try {
            const data = await spotifyApi.authorizationCodeGrant(code);
            const { access_token, refresh_token, expires_in } = data.body;

            this.userSessions.set(discordUserId, {
                accessToken: access_token,
                refreshToken: refresh_token,
                expiresAt: Date.now() + expires_in * 1000,
                userId: discordUserId,
            });

            // Save tokens to file for persistence
            this.saveTokensToFile();

            return discordUserId;
        } catch (error) {
            console.error('Spotify auth error:', error);
            return null;
        }
    }

    async refreshTokenIfNeeded(discordUserId: string): Promise<boolean> {
        const session = this.userSessions.get(discordUserId);
        if (!session) return false;

        // Refresh if token expires in less than 5 minutes
        if (Date.now() > session.expiresAt - 5 * 60 * 1000) {
            const spotifyApi = this.createSpotifyApi();
            spotifyApi.setRefreshToken(session.refreshToken);

            try {
                const data = await spotifyApi.refreshAccessToken();
                session.accessToken = data.body.access_token;
                session.expiresAt = Date.now() + data.body.expires_in * 1000;
                
                if (data.body.refresh_token) {
                    session.refreshToken = data.body.refresh_token;
                }
                
                this.userSessions.set(discordUserId, session);
                
                // Save updated tokens to file
                this.saveTokensToFile();
                
                return true;
            } catch (error) {
                console.error('Token refresh error:', error);
                // If refresh fails, the token might be revoked - remove it
                this.userSessions.delete(discordUserId);
                this.saveTokensToFile();
                return false;
            }
        }

        return true;
    }

    async getCurrentlyPlaying(discordUserId: string): Promise<CurrentlyPlaying | null> {
        const session = this.userSessions.get(discordUserId);
        if (!session) return null;

        await this.refreshTokenIfNeeded(discordUserId);

        const spotifyApi = this.createSpotifyApi();
        spotifyApi.setAccessToken(session.accessToken);

        try {
            const response = await spotifyApi.getMyCurrentPlayingTrack();
            
            if (!response.body || !response.body.item || response.body.item.type !== 'track') {
                return null;
            }

            const track = response.body.item;
            
            return {
                trackName: track.name,
                artistName: track.artists.map((a: { name: string }) => a.name).join(', '),
                albumName: track.album.name,
                isPlaying: response.body.is_playing ?? false,
                progressMs: response.body.progress_ms ?? 0,
                durationMs: track.duration_ms,
                trackUrl: track.external_urls?.spotify ?? null,
                albumArtUrl: track.album.images[0]?.url ?? null,
            };
        } catch (error) {
            console.error('Error getting currently playing:', error);
            return null;
        }
    }

    isUserConnected(discordUserId: string): boolean {
        return this.userSessions.has(discordUserId);
    }

    disconnectUser(discordUserId: string): void {
        this.userSessions.delete(discordUserId);
        this.saveTokensToFile();
    }

    getSession(discordUserId: string): SpotifyUserSession | undefined {
        return this.userSessions.get(discordUserId);
    }
}

export const spotifyService = new SpotifyService();
