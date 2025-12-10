import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    Events,
    DiscordAPIError,
    MessageFlags,
} from 'discord.js';
import { config, validateConfig } from './config';
import { commands } from './commands';
import { startServer, stopServer } from './server';

// Global error handlers to prevent crashes
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
    // EPIPE errors happen when we kill audio streams - don't crash
    if (error.code === 'EPIPE' || error.code === 'ERR_STREAM_DESTROYED') {
        console.log('[Process] Ignoring EPIPE/stream error (expected during track changes)');
        return;
    }
    console.error('Uncaught Exception:', error);
});

// Discord client - initialized lazily
let client: Client | null = null;

// Graceful shutdown handler
async function gracefulShutdown(signal: string): Promise<void> {
    console.log(`\n🛑 Received ${signal}. Shutting down gracefully...`);
    
    // Stop the HTTP server
    await stopServer();
    
    // Destroy Discord client if it exists
    if (client) {
        console.log('🔌 Disconnecting from Discord...');
        client.destroy();
        console.log('✅ Discord client destroyed');
    }
    
    console.log('👋 Goodbye!');
    process.exit(0);
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

function getClient(): Client {
    if (!client) {
        client = new Client({
            intents: [
                GatewayIntentBits.Guilds,
                GatewayIntentBits.GuildVoiceStates,
                GatewayIntentBits.GuildMessages,
            ],
        });

        // Handle interactions
        client.on(Events.InteractionCreate, async (interaction) => {
            if (!interaction.isChatInputCommand()) return;

            const command = commands.find(
                (cmd) => cmd.data.name === interaction.commandName
            );

            if (!command) return;

            try {
                await command.execute(interaction);
            } catch (error) {
                console.error('Error executing command:', error);
                
                // Check if the error is an expired interaction (code 10062)
                if (error instanceof DiscordAPIError && error.code === 10062) {
                    console.log('Interaction expired - user may need to try again');
                    return; // Don't try to respond to an expired interaction
                }
                
                const errorMessage = '❌ An error occurred while executing this command.';
                
                try {
                    if (interaction.replied || interaction.deferred) {
                        await interaction.followUp({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
                    } else {
                        await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral }).catch(() => {});
                    }
                } catch (replyError) {
                    // Interaction may have expired, just log it
                    console.error('Could not send error response:', replyError);
                }
            }
        });

        // Handle Discord client errors
        client.on('error', (error) => {
            console.error('Discord client error:', error);
        });

        // Bot ready event
        client.once(Events.ClientReady, (readyClient) => {
            console.log(`✅ Bot is ready! Logged in as ${readyClient.user.tag}`);
            console.log(`📡 Serving ${readyClient.guilds.cache.size} servers`);
        });
    }
    return client;
}

// Register slash commands
async function registerCommands(): Promise<void> {
    if (!config.discord.token || !config.discord.clientId) {
        console.log('Skipping command registration - Discord credentials not configured');
        return;
    }

    const rest = new REST({ version: '10' }).setToken(config.discord.token);

    try {
        console.log('Registering slash commands...');

        await rest.put(
            Routes.applicationCommands(config.discord.clientId),
            {
                body: commands.map((cmd) => cmd.data.toJSON()),
            }
        );

        console.log('Slash commands registered successfully!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Start the bot
async function main(): Promise<void> {
    // Start OAuth callback server FIRST - Cloud Run needs this to pass health checks
    console.log('Starting HTTP server...');
    startServer();

    // Validate config (logs warnings but doesn't crash)
    validateConfig();

    // Check if we have Discord credentials before trying to connect
    if (!config.discord.token) {
        console.log('Discord token not configured - bot will only serve HTTP requests');
        return;
    }

    try {
        // Register commands
        await registerCommands();

        // Login to Discord
        const discordClient = getClient();
        await discordClient.login(config.discord.token);
    } catch (error) {
        console.error('Failed to start bot:', error);
        // Don't exit - keep server running for Cloud Run health checks
        console.error('Bot functionality may be limited, but server is still running.');
    }
}

main();
