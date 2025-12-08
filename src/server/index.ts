import express from 'express';
import { config } from '../config';
import { spotifyService } from '../services/spotify';

const app = express();

app.get('/callback', async (req, res) => {
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

export function startServer(): void {
    app.listen(config.server.port, () => {
        console.log(`OAuth callback server running on http://localhost:${config.server.port}`);
    });
}
