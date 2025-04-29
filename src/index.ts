import { Client, GatewayIntentBits, MessageFlags, REST, Routes, SlashCommandBuilder } from 'discord.js';
import type { Message, Interaction, ChatInputCommandInteraction } from 'discord.js';
import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();
if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_GUILD_ID) {
  throw new Error('Missing environment variables! Please check your .env file.');
}

// 定数定義
const CONFIG = {
    BOT_TOKEN: process.env.DISCORD_BOT_TOKEN || '',
    CLIENT_ID: process.env.DISCORD_CLIENT_ID || '',
    GUILD_ID: process.env.DISCORD_GUILD_ID || '',
    POINTS_FILE: path.resolve(process.cwd(), 'points.json'),
    POINT_COOLDOWN_HOURS: 24,
    MAX_RANKING_DISPLAY: 10
} as const;

// 型定義
type PointData = {
    score: number;
    lastClaimedAt: string;
};

type Points = Record<string, PointData>;

// コミュニティポイントシステムクラス
class PointSystem {
    private points: Points = {};

    constructor() {
        this.loadPoints();
    }

    private loadPoints(): void {
        if (fs.existsSync(CONFIG.POINTS_FILE)) {
            this.points = JSON.parse(fs.readFileSync(CONFIG.POINTS_FILE, 'utf-8'));
        }
    }

    private savePoints(): void {
        fs.writeFileSync(CONFIG.POINTS_FILE, JSON.stringify(this.points, null, 2));
    }

    public getOrCreateUserPoints(userId: string): PointData {
        if (!this.points[userId]) {
            this.points[userId] = { score: 0, lastClaimedAt: '' };
        }
        return this.points[userId];
    }

    private canClaimPoints(lastClaimedAt: string): boolean {
        const now = new Date();
        const lastClaimed = lastClaimedAt ? new Date(lastClaimedAt) : new Date(0);
        const hoursSinceLastClaim = (now.getTime() - lastClaimed.getTime()) / (1000 * 60 * 60);
        return hoursSinceLastClaim >= CONFIG.POINT_COOLDOWN_HOURS;
    }

    public tryClaimPoints(userId: string): boolean {
        const userPoints = this.getOrCreateUserPoints(userId);

        if (this.canClaimPoints(userPoints.lastClaimedAt)) {
            userPoints.score += 1;
            userPoints.lastClaimedAt = new Date().toISOString();
            this.savePoints();
            return true;
        }

        return false;
    }

    public getTopUsers(limit: number): [string, PointData][] {
        return Object.entries(this.points)
            .sort((a, b) => b[1].score - a[1].score)
            .slice(0, limit);
    }
}

// Discordクライアントの設定
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
    ]
});

const pointSystem = new PointSystem();

// スラッシュコマンドの設定
const commands = [
    new SlashCommandBuilder()
        .setName('ranking')
        .setDescription('コミュニティポイントランキングを表示します'),
    new SlashCommandBuilder()
        .setName('mypoints')
        .setDescription('自分のコミュニティポイントを確認します'),
].map(cmd => cmd.toJSON());

// スラッシュコマンドの登録
const rest = new REST({ version: '10' }).setToken(CONFIG.BOT_TOKEN);

async function registerCommands() {
    try {
        await rest.put(
            Routes.applicationGuildCommands(CONFIG.CLIENT_ID, CONFIG.GUILD_ID),
            { body: commands },
        );
        console.log('Slash commands registered.');
    } catch (error) {
        console.error('Failed to register slash commands:', error);
    }
}

// イベントハンドラー
const handleMessage = (message: Message) => {
    if (message.author.bot) return;
    pointSystem.tryClaimPoints(message.author.id);
};

const handleInteraction = async (interaction: Interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const { commandName, user } = interaction as ChatInputCommandInteraction;

  switch (commandName) {
    case 'ranking': {
      const topUsers = pointSystem.getTopUsers(CONFIG.MAX_RANKING_DISPLAY);
      let message = '';

      for (const [index, [userId, data]] of topUsers.entries()) {
        let username = 'Unknown User';
        try {
          const fetchedUser = await client.users.fetch(userId);
          username = fetchedUser.username;
        } catch {
          console.warn(`Failed to fetch user ${userId}`);
        }
        message += `${index + 1}. ${username}: ${data.score}pt\n`;
      }

      await interaction.reply({
        content: message || 'まだ誰もコミュニティポイントを獲得していません！',
        flags: MessageFlags.Ephemeral
      });
      break;
    }

    case 'mypoints': {
      const userPoints = pointSystem.getOrCreateUserPoints(user.id);

      await interaction.reply({
        content: `あなたの現在のコミュニティポイントは **${userPoints.score}pt** です！`,
        flags: MessageFlags.Ephemeral
      });
      break;
    }

    default:
      break;
  }
};

// イベントリスナーの設定
client.on('messageCreate', handleMessage);
client.on('interactionCreate', handleInteraction);

// 起動処理
const startBot = async () => {
    await registerCommands();
    await client.login(CONFIG.BOT_TOKEN);
    console.log('Bot is ready!');
};

startBot().catch(console.error);
