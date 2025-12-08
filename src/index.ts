import {
    Client,
    GatewayIntentBits,
    REST,
    Routes,
    Events,
} from 'discord.js';
import { config, validateConfig } from './config';
import { commands } from './commands';
import { startServer } from './server';

// Validate environment variables
validateConfig();

// Create Discord client
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMessages,
    ],
});

// Register slash commands
async function registerCommands(): Promise<void> {
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
        
        const errorMessage = '❌ An error occurred while executing this command.';
        
        if (interaction.replied || interaction.deferred) {
            await interaction.followUp({ content: errorMessage, ephemeral: true });
        } else {
            await interaction.reply({ content: errorMessage, ephemeral: true });
        }
    }
});

// Bot ready event
client.once(Events.ClientReady, (readyClient) => {
    console.log(`✅ Bot is ready! Logged in as ${readyClient.user.tag}`);
    console.log(`📡 Serving ${readyClient.guilds.cache.size} servers`);
});

// Start the bot
async function main(): Promise<void> {
    try {
        // Start OAuth callback server
        startServer();

        // Register commands
        await registerCommands();

        // Login to Discord
        await client.login(config.discord.token);
    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

main();
