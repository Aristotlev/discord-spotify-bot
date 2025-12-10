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

// Store server reference for graceful shutdown
let server: https.Server | http.Server | null = null;

export function startServer(): void {
    const host = '0.0.0.0';
    
    // Check if running on Cloud Run (Cloud Run sets K_SERVICE env var)
    const isCloudRun = !!process.env.K_SERVICE;
    
    // Try to load SSL certificates for HTTPS (only for local/self-hosted)
    const certPath = path.join(process.cwd(), 'certs', 'cert.pem');
    const keyPath = path.join(process.cwd(), 'certs', 'key.pem');
    
    // Debug logging
    console.log(`🔍 CWD: ${process.cwd()}`);
    console.log(`🔍 certPath: ${certPath} exists: ${fs.existsSync(certPath)}`);
    console.log(`🔍 keyPath: ${keyPath} exists: ${fs.existsSync(keyPath)}`);
    console.log(`🔍 isCloudRun: ${isCloudRun}`);
    
    // Use HTTP on Cloud Run (it handles HTTPS termination), HTTPS otherwise if certs exist
    if (!isCloudRun && fs.existsSync(certPath) && fs.existsSync(keyPath)) {
        // HTTPS server with SSL certificates (for self-hosted)
        try {
            const httpsOptions = {
                key: fs.readFileSync(keyPath),
                cert: fs.readFileSync(certPath),
            };
            console.log('🔑 Loaded SSL certificates, starting HTTPS server...');
            
            server = https.createServer(httpsOptions, app).listen(config.server.port, host, () => {
                console.log(`🔒 HTTPS OAuth callback server running on https://${host}:${config.server.port}`);
            });
        } catch (err) {
            console.error('❌ Failed to start HTTPS server:', err);
            console.log('⚠️ Falling back to HTTP...');
            server = app.listen(config.server.port, host, () => {
                console.log(`🌐 HTTP server running on http://${host}:${config.server.port}`);
            });
        }
    } else {
        // HTTP server (Cloud Run handles HTTPS termination, or local dev without certs)
        if (isCloudRun) {
            console.log('☁️ Running on Cloud Run - using HTTP (HTTPS handled by Cloud Run)');
        } else {
            console.log('⚠️ SSL certificates not found, using HTTP');
        }
        server = app.listen(config.server.port, host, () => {
            console.log(`🌐 HTTP server running on http://${host}:${config.server.port}`);
        });
    }
    
    // Handle server errors (like port already in use)
    server.on('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'EADDRINUSE') {
            console.error(`❌ Port ${config.server.port} is already in use!`);
            console.error('Try: sudo fuser -k ' + config.server.port + '/tcp');
        } else {
            console.error('Server error:', error);
        }
    });
}

export function stopServer(): Promise<void> {
    return new Promise((resolve) => {
        if (server) {
            console.log('🛑 Closing server...');
            server.close(() => {
                console.log('✅ Server closed');
                resolve();
            });
        } else {
            resolve();
        }
    });
}
