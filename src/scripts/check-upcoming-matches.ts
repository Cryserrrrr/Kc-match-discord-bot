import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { createMatchEmbed } from "../utils/embedBuilder";
import { logger } from "../utils/logger";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_DELAY = 2000; // 2 seconds
const MAX_DELAY = 60000; // 60 seconds

/**
 * Retry function with exponential backoff
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  initialDelay: number = INITIAL_DELAY
): Promise<T> {
  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      logger.info(`🔄 Attempt ${attempt}/${maxRetries}`);
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

      // Exponential backoff with max delay
      delay = Math.min(delay * 2, MAX_DELAY);
    }
  }

  throw lastError!;
}

// Global instances with connection pooling
let prisma: PrismaClient | null = null;
let client: Client | null = null;
let isClientReady = false;

// Cache for guild settings to avoid repeated database queries
let guildSettingsCache: any[] | null = null;
let lastCacheUpdate = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Initialize Prisma with connection pooling
function getPrismaClient(): PrismaClient {
  if (!prisma) {
    prisma = new PrismaClient({
      datasources: {
        db: {
          url: process.env.DATABASE_URL,
        },
      },
      // Optimize for frequent short-lived connections
      log: ["error", "warn"],
    });
  }
  return prisma;
}

// Initialize Discord client with connection reuse
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

// Cache guild settings to avoid repeated database queries
async function getGuildSettings(): Promise<any[]> {
  const now = Date.now();

  if (guildSettingsCache && now - lastCacheUpdate < CACHE_DURATION) {
    return guildSettingsCache;
  }

  const prismaClient = getPrismaClient();
  guildSettingsCache = await prismaClient.guildSettings.findMany();

  lastCacheUpdate = now;
  logger.debug(
    `Updated guild settings cache with ${guildSettingsCache.length} entries`
  );

  return guildSettingsCache;
}

async function checkUpcomingMatches() {
  const startTime = Date.now();
  let prismaClient: PrismaClient | null = null;

  try {
    logger.info("Starting check for upcoming matches...");

    // Get current time
    const now = new Date();

    // Find matches that start in the next 30-35 minutes (to account for cron frequency)
    const thirtyMinutesFromNow = new Date(now.getTime() + 30 * 60 * 1000);
    const thirtyFiveMinutesFromNow = new Date(now.getTime() + 35 * 60 * 1000);

    // Initialize Prisma with retry
    await withRetry(async () => {
      prismaClient = getPrismaClient();
      // Test connection
      await prismaClient.$queryRaw`SELECT 1`;
      logger.info("✅ Database connection established");
    });

    // Optimized query with specific field selection
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

    // Get guild settings once and reuse
    const guildSettings = await withRetry(async () => {
      return await getGuildSettings();
    });

    if (guildSettings.length === 0) {
      logger.warn("No guild settings found. No channels to announce to.");
      return;
    }

    // Process matches in parallel for better performance
    const notificationPromises = upcomingMatches.map((match) =>
      sendNotificationForMatch(match, guildSettings)
    );

    await Promise.allSettled(notificationPromises);

    const executionTime = Date.now() - startTime;
    logger.info(
      `Finished checking and sending notifications for upcoming matches in ${executionTime}ms`
    );
  } catch (error) {
    logger.error("💥 CRITICAL ERROR - Script failed after all retries:", error);
    throw error;
  } finally {
    // Don't disconnect Prisma client to keep connection pool alive
    // Only destroy Discord client if it exists
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
    logger.info(
      `Sending 30-minute notification for match ${match.id} (${match.kcTeam} vs ${match.opponent})`
    );

    // Get Discord client with retry
    const discordClient = await withRetry(async () => {
      return await getDiscordClient();
    });

    // Create embed for the match
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

    // Send notification to all configured channels in parallel
    const channelPromises = guildSettings.map(async (setting) => {
      await withRetry(
        async () => {
          try {
            // Check if pre-match notifications are enabled for this guild
            if (!setting.enablePreMatchNotifications) {
              logger.debug(
                `Skipping match ${match.id} for guild ${setting.guildId} - pre-match notifications disabled`
              );
              return;
            }

            // Check if this match should be announced based on team filter
            if (setting.filteredTeams && setting.filteredTeams.length > 0) {
              if (!setting.filteredTeams.includes(match.kcId)) {
                logger.debug(
                  `Skipping match ${match.id} for guild ${setting.guildId} - team ${match.kcId} not in filter`
                );
                return;
              }
            }

            const guild = discordClient.guilds.cache.get(setting.guildId);
            if (!guild) {
              logger.warn(`Guild ${setting.guildId} not found`);
              return;
            }

            const channel = guild.channels.cache.get(
              setting.channelId
            ) as TextChannel;
            if (!channel) {
              logger.warn(
                `Channel ${setting.channelId} not found in guild ${setting.guildId}`
              );
              return;
            }

            // Send the notification with timeout
            const message = `⏰ **Match dans 30 minutes !** ⏰\n${setting.customMessage}`;

            await Promise.race([
              channel.send({
                content: message,
                embeds: [embed],
              }),
              new Promise((_, reject) =>
                setTimeout(() => reject(new Error("Send timeout")), 10000)
              ),
            ]);

            logger.info(
              `Sent 30-minute notification for match ${match.id} to channel ${setting.channelId} in guild ${setting.guildId}`
            );
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
      ); // 3 retries for individual channels, 1 second delay
    });

    await Promise.allSettled(channelPromises);
  } catch (error) {
    logger.error(`Error sending notification for match ${match.id}:`, error);
    throw error;
  }
}

// Cleanup function for graceful shutdown
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

// Handle process termination
process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Run the script if called directly
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
