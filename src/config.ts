import dotenv from 'dotenv';

dotenv.config();

export const config = {
    discord: {
        token: process.env.DISCORD_TOKEN!,
        clientId: process.env.DISCORD_CLIENT_ID!,
    },
    spotify: {
        clientId: process.env.SPOTIFY_CLIENT_ID!,
        clientSecret: process.env.SPOTIFY_CLIENT_SECRET!,
        redirectUri: process.env.SPOTIFY_REDIRECT_URI || 'http://localhost:3000/callback',
    },
    server: {
        port: parseInt(process.env.PORT || '3000', 10),
    },
};

export function validateConfig(): void {
    const required = [
        'DISCORD_TOKEN',
        'DISCORD_CLIENT_ID',
        'SPOTIFY_CLIENT_ID',
        'SPOTIFY_CLIENT_SECRET',
    ];

    const missing = required.filter((key) => !process.env[key]);

    if (missing.length > 0) {
        console.error(`⚠️ Missing required environment variables: ${missing.join(', ')}`);
        console.error('Bot functionality will be limited until these are configured.');
        // Don't throw - let the server start for Cloud Run health checks
    }
}
