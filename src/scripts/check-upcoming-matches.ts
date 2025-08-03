import { PrismaClient } from "@prisma/client";
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  ChannelType,
} from "discord.js";
import { createMatchEmbed } from "../utils/embedBuilder";
import { logger } from "../utils/logger";
import dotenv from "dotenv";

dotenv.config();

const MAX_RETRIES = 5;
const INITIAL_DELAY = 2000;
const MAX_DELAY = 60000;

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  initialDelay: number = INITIAL_DELAY
): Promise<T> {
  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      logger.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        logger.error(
          `💥 All ${maxRetries} attempts failed. Final error:`,
          lastError
        );
        throw lastError;
      }

      logger.info(`⏳ Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      delay = Math.min(delay * 2, MAX_DELAY);
    }
  }

  throw lastError!;
}

let prisma: PrismaClient | null = null;
let client: Client | null = null;
let isClientReady = false;

let guildSettingsCache: any[] | null = null;
let lastCacheUpdate = 0;
const CACHE_DURATION = 5 * 60 * 1000;

function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      log: ["error", "warn"],
    });
  }
  return prisma;
}

async function getDiscordClient(): Promise<Client> {
  if (!client) {
    client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
  }

  if (!isClientReady) {
    await withRetry(async () => {
      try {
        await client!.login(process.env.DISCORD_TOKEN);
        isClientReady = true;
        logger.info(`Logged in as ${client!.user?.tag}`);
      } catch (error) {
        logger.error("Failed to login to Discord:", error);
        throw error;
      }
    });
  }

  return client;
}

async function getGuildSettings(): Promise<any[]> {
  const now = Date.now();

  if (guildSettingsCache && now - lastCacheUpdate < CACHE_DURATION) {
    return guildSettingsCache;
  }

  const prismaClient = getPrismaClient();
  guildSettingsCache = await prismaClient.guildSettings.findMany();

  lastCacheUpdate = now;

  return guildSettingsCache;
}

async function checkUpcomingMatches() {
  const startTime = Date.now();
  let prismaClient: PrismaClient | null = null;

  try {
    const now = new Date();

    // Find matches that start in the next 30-35 minutes (to account for cron frequency)
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    const thirtyFiveMinutesFromNow = new Date(now.getTime() + 35 * 60 * 1000);

    await withRetry(async () => {
      prismaClient = getPrismaClient();
      await prismaClient.$queryRaw`SELECT 1`;
    });

    const upcomingMatches = await withRetry(async () => {
      if (!prismaClient) throw new Error("Prisma client not initialized");

      return await prismaClient.match.findMany({
        where: {
          beginAt: {
            gte: thirtyMinutesFromNow,
            lte: thirtyFiveMinutesFromNow,
          },
        },
        select: {
          id: true,
          kcTeam: true,
          kcId: true,
          opponent: true,
          opponentImage: true,
          tournamentName: true,
          leagueName: true,
          leagueImage: true,
          serieName: true,
          numberOfGames: true,
          beginAt: true,
        },
        orderBy: {
          beginAt: "asc",
        },
      });
    });

    logger.info(
      `Found ${upcomingMatches.length} matches starting in the next 30-35 minutes`
    );

    if (upcomingMatches.length === 0) {
      logger.info("No matches to notify about");
      return;
    }

    const guildSettings = await withRetry(async () => {
      return await getGuildSettings();
    });

    if (guildSettings.length === 0) {
      logger.warn("No guild settings found. No channels to announce to.");
      return;
    }

    const notificationPromises = upcomingMatches.map((match) =>
      sendNotificationForMatch(match, guildSettings)
    );

    await Promise.allSettled(notificationPromises);
  } catch (error) {
    logger.error("💥 CRITICAL ERROR - Script failed after all retries:", error);
    throw error;
  } finally {
    if (client && isClientReady) {
      try {
        await client.destroy();
        client = null;
        isClientReady = false;
      } catch (error) {
        logger.warn("Error destroying Discord client:", error);
      }
    }
  }
}

async function sendNotificationForMatch(match: any, guildSettings: any[]) {
  try {
    const discordClient = await withRetry(async () => {
      return await getDiscordClient();
    });

    const embed = await withRetry(async () => {
      return await createMatchEmbed({
        kcTeam: match.kcTeam,
        kcId: match.kcId,
        opponent: match.opponent,
        opponentImage: match.opponentImage || undefined,
        tournamentName: match.tournamentName,
        leagueName: match.leagueName,
        leagueImage: match.leagueImage || undefined,
        serieName: match.serieName,
        numberOfGames: match.numberOfGames,
        beginAt: match.beginAt,
      });
    });

    const channelPromises = guildSettings.map(async (setting) => {
      await withRetry(
        async () => {
          try {
            if (!setting.enablePreMatchNotifications) {
              return;
            }

            if (setting.filteredTeams && setting.filteredTeams.length > 0) {
              if (!setting.filteredTeams.includes(match.kcId)) {
                return;
              }
            }

            const guild = discordClient.guilds.cache.get(setting.guildId);
            if (!guild) {
              logger.warn(`Guild ${setting.guildId} not found`);
              return;
            }

            try {
              await guild.fetch();
            } catch (error) {
              logger.warn(`Failed to fetch guild ${setting.guildId}:`, error);
            }

            const channel = guild.channels.cache.get(
              setting.channelId
            ) as TextChannel;
            if (!channel) {
              return;
            }

            const message = `⏰ **Match dans 30 minutes !** ⏰`;

            await Promise.race([
              channel.send({
                content: message,
                embeds: [embed],
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Send timeout")), 10000)
              ),
            ]);
          } catch (error) {
            logger.error(
              `Error sending notification to guild ${setting.guildId}:`,
              error
            );
            throw error; // Re-throw to trigger retry
          }
        },
        3,
        1000
      );
    });

    await Promise.allSettled(channelPromises);
  } catch (error) {
    logger.error(`Error sending notification for match ${match.id}:`, error);
    throw error;
  }
}

export async function cleanup() {
  if (prisma) {
    await prisma.$disconnect();
    prisma = null;
  }
  if (client && isClientReady) {
    await client.destroy();
    client = null;
    isClientReady = false;
  }
  guildSettingsCache = null;
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

if (require.main === module) {
  checkUpcomingMatches()
    .then(async () => {
      logger.info("Script completed successfully");
      await cleanup();
      process.exit(0);
    })
    .catch(async (error) => {
      logger.error(
        "💥 CRITICAL ERROR - Script failed after all retries:",
        error
      );
      await cleanup();
      process.exit(1);
    });
}

export { checkUpcomingMatches };
