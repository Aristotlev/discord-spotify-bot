import {
    SlashCommandBuilder,
    ChatInputCommandInteraction,
    EmbedBuilder,
    GuildMember,
    ChannelType,
} from 'discord.js';
import { spotifyService } from '../services/spotify';
import { voiceManager } from '../services/voice';

export interface Command {
    data: SlashCommandBuilder;
    execute: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

// /spotify-login command
export const spotifyLoginCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('spotify-login')
        .setDescription('Connect your Spotify account to the bot'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        const authUrl = spotifyService.getAuthUrl(interaction.user.id);
        console.log('[SpotifyLogin] Generated auth URL:', authUrl);
        
        const embed = new EmbedBuilder()
            .setTitle('🎵 Connect Spotify')
            .setDescription(
                `Click [here](${authUrl}) to connect your Spotify account.\n\n` +
                'After authorizing, you can use `/connect` to join a voice channel.'
            )
            .setColor(0x1DB954);

        await interaction.reply({ embeds: [embed], ephemeral: true });
    },
};

// /connect command
export const connectCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('connect')
        .setDescription('Connect the bot to your current voice channel'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        // Defer IMMEDIATELY to prevent interaction timeout
        await interaction.deferReply();
        
        const member = interaction.member as GuildMember;
        
        if (!member.voice.channel) {
            await interaction.editReply({
                content: '❌ You need to be in a voice channel first!',
            });
            return;
        }

        if (member.voice.channel.type !== ChannelType.GuildVoice) {
            await interaction.editReply({
                content: '❌ Please join a regular voice channel.',
            });
            return;
        }

        const result = await voiceManager.connectToChannel(
            member.voice.channel,
            member
        );

        const embed = new EmbedBuilder()
            .setTitle(result.success ? '✅ Connected' : '❌ Connection Failed')
            .setDescription(result.message)
            .setColor(result.success ? 0x1DB954 : 0xFF0000);

        await interaction.editReply({ embeds: [embed] });
    },
};

// /disconnect command
export const disconnectCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('disconnect')
        .setDescription('Disconnect the bot from the voice channel'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        if (!interaction.guildId) {
            await interaction.reply({
                content: '❌ This command can only be used in a server.',
                ephemeral: true,
            });
            return;
        }

        const session = voiceManager.getSession(interaction.guildId);
        
        if (!session) {
            await interaction.reply({
                content: '❌ Bot is not connected to any voice channel.',
                ephemeral: true,
            });
            return;
        }

        // Only the controlling user can disconnect
        if (session.controllingUserId !== interaction.user.id) {
            await interaction.reply({
                content: `❌ Only <@${session.controllingUserId}> can disconnect the bot.`,
                ephemeral: true,
            });
            return;
        }

        const result = voiceManager.disconnect(interaction.guildId);

        const embed = new EmbedBuilder()
            .setTitle(result.success ? '👋 Disconnected' : '❌ Error')
            .setDescription(result.message)
            .setColor(result.success ? 0x1DB954 : 0xFF0000);

        await interaction.reply({ embeds: [embed] });
    },
};

// /now-playing command
export const nowPlayingCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('now-playing')
        .setDescription('Show what is currently playing'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        // Defer IMMEDIATELY to prevent interaction timeout
        await interaction.deferReply();
        
        if (!interaction.guildId) {
            await interaction.editReply({
                content: '❌ This command can only be used in a server.',
            });
            return;
        }

        const session = voiceManager.getSession(interaction.guildId);
        
        if (!session) {
            await interaction.editReply({
                content: '❌ Bot is not connected to any voice channel.',
            });
            return;
        }

        const currentlyPlaying = await spotifyService.getCurrentlyPlaying(
            session.controllingUserId
        );

        if (!currentlyPlaying) {
            await interaction.editReply({
                content: '🔇 Nothing is currently playing on Spotify.',
            });
            return;
        }

        const progressBar = createProgressBar(
            currentlyPlaying.progressMs,
            currentlyPlaying.durationMs
        );

        const embed = new EmbedBuilder()
            .setTitle(currentlyPlaying.isPlaying ? '🎵 Now Playing' : '⏸️ Paused')
            .setDescription(
                `**${currentlyPlaying.trackName}**\n` +
                `by ${currentlyPlaying.artistName}\n` +
                `on ${currentlyPlaying.albumName}\n\n` +
                `${progressBar}\n` +
                `${formatTime(currentlyPlaying.progressMs)} / ${formatTime(currentlyPlaying.durationMs)}`
            )
            .setColor(0x1DB954)
            .setFooter({ text: `Controlled by @${session.controllingUserId}` });

        if (currentlyPlaying.albumArtUrl) {
            embed.setThumbnail(currentlyPlaying.albumArtUrl);
        }

        if (currentlyPlaying.trackUrl) {
            embed.setURL(currentlyPlaying.trackUrl);
        }

        await interaction.editReply({ embeds: [embed] });
    },
};

// /spotify-logout command
export const spotifyLogoutCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('spotify-logout')
        .setDescription('Disconnect your Spotify account from the bot'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        if (!spotifyService.isUserConnected(interaction.user.id)) {
            await interaction.reply({
                content: '❌ Your Spotify account is not connected.',
                ephemeral: true,
            });
            return;
        }

        spotifyService.disconnectUser(interaction.user.id);

        await interaction.reply({
            content: '✅ Your Spotify account has been disconnected.',
            ephemeral: true,
        });
    },
};

// /sync command - alias for /connect
export const syncCommand: Command = {
    data: new SlashCommandBuilder()
        .setName('sync')
        .setDescription('Sync Spotify playback to your voice channel'),
    
    async execute(interaction: ChatInputCommandInteraction) {
        // Defer IMMEDIATELY to prevent interaction timeout
        await interaction.deferReply();
        
        const member = interaction.member as GuildMember;
        
        if (!member.voice.channel) {
            await interaction.editReply({
                content: '❌ You need to be in a voice channel first!',
            });
            return;
        }

        if (member.voice.channel.type !== ChannelType.GuildVoice) {
            await interaction.editReply({
                content: '❌ Please join a regular voice channel.',
            });
            return;
        }

        const result = await voiceManager.connectToChannel(
            member.voice.channel,
            member
        );

        const embed = new EmbedBuilder()
            .setTitle(result.success ? '✅ Syncing' : '❌ Sync Failed')
            .setDescription(result.message)
            .setColor(result.success ? 0x1DB954 : 0xFF0000);

        await interaction.editReply({ embeds: [embed] });
    },
};

// Helper functions
function createProgressBar(current: number, total: number): string {
    const barLength = 15;
    const progress = Math.round((current / total) * barLength);
    const empty = barLength - progress;
    return '▓'.repeat(progress) + '░'.repeat(empty);
}

function formatTime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
}

export const commands: Command[] = [
    spotifyLoginCommand,
    connectCommand,
    syncCommand,
    disconnectCommand,
    nowPlayingCommand,
    spotifyLogoutCommand,
];
