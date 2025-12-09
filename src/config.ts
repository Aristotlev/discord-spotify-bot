import dotenv from 'dotenv';
import path from 'path';

// Load environment-specific .env file
// Priority: .env.development (if NODE_ENV not set or is development) > .env
const envFile = process.env.NODE_ENV === 'production' 
    ? '.env' 
    : '.env.development';

// Try to load the environment-specific file first
const envPath = path.resolve(process.cwd(), envFile);
const result = dotenv.config({ path: envPath });

// Fall back to default .env if environment-specific file doesn't exist
if (result.error) {
    dotenv.config();
}

console.log(`📁 Loaded config from: ${result.error ? '.env' : envFile}`);
console.log(`🌐 Redirect URI: ${process.env.SPOTIFY_REDIRECT_URI}`);

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
