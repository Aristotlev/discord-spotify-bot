import SpotifyWebApi from 'spotify-web-api-node';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';
import { Storage } from '@google-cloud/storage';

const TOKENS_FILE = path.join(process.cwd(), 'spotify-tokens.json');
const GCS_BUCKET = 'spoti-bot-tokens-480617';
const GCS_FILE = 'spotify-tokens.json';

// Use Cloud Storage in production, local file in development
const useCloudStorage = process.env.NODE_ENV === 'production';
const storage = useCloudStorage ? new Storage() : null;

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
    private initialized: boolean = false;

    constructor() {
        this.loadTokens();
    }

    private async loadTokens(): Promise<void> {
        try {
            if (useCloudStorage && storage) {
                // Load from Google Cloud Storage
                const bucket = storage.bucket(GCS_BUCKET);
                const file = bucket.file(GCS_FILE);
                
                const [exists] = await file.exists();
                if (exists) {
                    const [contents] = await file.download();
                    const tokens: Record<string, SpotifyUserSession> = JSON.parse(contents.toString());
                    
                    for (const [userId, session] of Object.entries(tokens)) {
                        this.userSessions.set(userId, session);
                    }
                    console.log(`✅ Loaded ${this.userSessions.size} Spotify session(s) from Cloud Storage`);
                }
            } else {
                // Load from local file
                if (fs.existsSync(TOKENS_FILE)) {
                    const data = fs.readFileSync(TOKENS_FILE, 'utf-8');
                    const tokens: Record<string, SpotifyUserSession> = JSON.parse(data);
                    
                    for (const [userId, session] of Object.entries(tokens)) {
                        this.userSessions.set(userId, session);
                    }
                    console.log(`✅ Loaded ${this.userSessions.size} Spotify session(s) from local storage`);
                }
            }
        } catch (error) {
            console.error('Error loading tokens:', error);
        }
        this.initialized = true;
    }

    private async saveTokens(): Promise<void> {
        try {
            const tokens: Record<string, SpotifyUserSession> = {};
            
            for (const [userId, session] of this.userSessions.entries()) {
                tokens[userId] = session;
            }
            
            const data = JSON.stringify(tokens, null, 2);

            if (useCloudStorage && storage) {
                // Save to Google Cloud Storage
                const bucket = storage.bucket(GCS_BUCKET);
                const file = bucket.file(GCS_FILE);
                await file.save(data, { contentType: 'application/json' });
                console.log('✅ Saved tokens to Cloud Storage');
            } else {
                // Save to local file
                fs.writeFileSync(TOKENS_FILE, data);
            }
        } catch (error) {
            console.error('Error saving tokens:', error);
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
            this.saveTokens();

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
                this.saveTokens();
                
                return true;
            } catch (error) {
                console.error('Token refresh error:', error);
                // If refresh fails, the token might be revoked - remove it
                this.userSessions.delete(discordUserId);
                this.saveTokens();
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
        this.saveTokens();
    }

    getSession(discordUserId: string): SpotifyUserSession | undefined {
        return this.userSessions.get(discordUserId);
    }
}

export const spotifyService = new SpotifyService();
