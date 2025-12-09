import express from 'express';
import https from 'https';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { config } from '../config';
import { spotifyService } from '../services/spotify';

const app = express();

// Log all incoming requests
app.use((req, res, next) => {
    console.log(`[Server] ${req.method} ${req.url}`);
    next();
});

app.get('/callback', async (req, res) => {
    console.log('[Callback] Received callback request');
    console.log('[Callback] Query params:', req.query);
    const { code, state, error } = req.query;

    if (error) {
        res.send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px;">
                    <h1>❌ Authorization Failed</h1>
                    <p>Error: ${error}</p>
                    <p>You can close this window.</p>
                </body>
            </html>
        `);
        return;
    }

    if (!code || !state) {
        res.status(400).send('Missing code or state parameter');
        return;
    }

    const discordUserId = await spotifyService.handleCallback(
        code as string,
        state as string
    );

    console.log('[Callback] handleCallback result:', discordUserId);

    if (discordUserId) {
        res.send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px; background: linear-gradient(135deg, #1DB954 0%, #191414 100%); color: white; min-height: 100vh;">
                    <h1>✅ Spotify Connected!</h1>
                    <p>Your Spotify account has been successfully linked to the Discord bot.</p>
                    <p>You can now close this window and use <code>/connect</code> in Discord.</p>
                </body>
            </html>
        `);
    } else {
        res.send(`
            <html>
                <body style="font-family: Arial, sans-serif; text-align: center; padding-top: 50px;">
                    <h1>❌ Authorization Failed</h1>
                    <p>Could not complete Spotify authorization. Please try again.</p>
                </body>
            </html>
        `);
    }
});

app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Root endpoint for basic connectivity check
app.get('/', (req, res) => {
    res.json({ status: 'ok', service: 'Discord Spotify Bot' });
});

export function startServer(): void {
    const host = '0.0.0.0';
    
    // Try to load SSL certificates for HTTPS
    const certPath = path.join(process.cwd(), 'certs', 'cert.pem');
    const keyPath = path.join(process.cwd(), 'certs', 'key.pem');
    
    if (fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        // HTTPS server with SSL certificates
        const httpsOptions = {
            key: fs.readFileSync(keyPath),
            cert: fs.readFileSync(certPath),
        };
        
        https.createServer(httpsOptions, app).listen(config.server.port, host, () => {
            console.log(`🔒 HTTPS OAuth callback server running on https://${host}:${config.server.port}`);
        });
    } else {
        // Fallback to HTTP (for local development)
        console.log('⚠️ SSL certificates not found, falling back to HTTP');
        app.listen(config.server.port, host, () => {
            console.log(`OAuth callback server running on http://${host}:${config.server.port}`);
        });
    }
}
