import { PrismaClient } from "@prisma/client";
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  ChannelType,
} from "discord.js";
import { createMatchEmbed, createScoreEmbed } from "../utils/embedBuilder";
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
      await prismaClient.$queryRaw`SELECT 1`;
      logger.info("✅ Database connection established");
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

    // Check for finished matches and send score notifications
    await checkFinishedMatchesAndSendScoreNotifications(
      prismaClient,
      guildSettings
    );

    const executionTime = Date.now() - startTime;
    logger.info(
      `Finished checking and sending notifications for upcoming matches in ${executionTime}ms`
    );
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

async function checkFinishedMatchesAndSendScoreNotifications(
  prismaClient: PrismaClient | null,
  guildSettings: any[]
) {
  try {
    if (!prismaClient) {
      logger.error("Prisma client is null");
      return;
    }

    logger.info(
      "🔍 Checking for finished matches to send score notifications..."
    );

    // Find matches that are finished but not yet announced
    const finishedMatches = await prismaClient.match.findMany({
      where: {
        status: "finished",
        score: {
          not: null,
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
        score: true,
      },
      orderBy: {
        beginAt: "desc",
      },
    });

    // Filter matches that are likely finished (older than 2 hours)
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
    const likelyFinishedMatches = finishedMatches.filter(
      (match) => match.beginAt < twoHoursAgo
    );

    logger.info(
      `Found ${likelyFinishedMatches.length} likely finished matches`
    );

    if (likelyFinishedMatches.length === 0) {
      logger.info("No finished matches to announce");
      return;
    }

    // Filter guild settings to only those that have score notifications enabled
    const guildSettingsWithScoreNotifications = guildSettings.filter(
      (setting) => setting.enableScoreNotifications !== false // Default to true if not set
    );

    if (guildSettingsWithScoreNotifications.length === 0) {
      logger.info("No guilds have score notifications enabled");
      return;
    }

    const scoreNotificationPromises = likelyFinishedMatches.map((match) =>
      sendScoreNotificationForMatch(
        match,
        guildSettingsWithScoreNotifications,
        prismaClient
      )
    );

    await Promise.allSettled(scoreNotificationPromises);
  } catch (error) {
    logger.error("Error checking finished matches:", error);
    // Don't throw here to avoid stopping the main process
  }
}

async function sendScoreNotificationForMatch(
  match: any,
  guildSettings: any[],
  prismaClient: PrismaClient
) {
  try {
    // For now, use a placeholder score until we can get real scores
    const placeholderScore = "2-1"; // This will be replaced with real score logic

    logger.info(
      `Sending score notification for match ${match.id} (${match.kcTeam} vs ${match.opponent}) - Score: ${placeholderScore}`
    );

    const discordClient = await withRetry(async () => {
      return await getDiscordClient();
    });

    const embed = await withRetry(async () => {
      return await createScoreEmbed({
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
        score: placeholderScore,
      });
    });

    const channelPromises = guildSettings.map(async (setting) => {
      await withRetry(
        async () => {
          try {
            if (setting.filteredTeams && setting.filteredTeams.length > 0) {
              if (!setting.filteredTeams.includes(match.kcId)) {
                logger.debug(
                  `Skipping score notification for match ${match.id} for guild ${setting.guildId} - team ${match.kcId} not in filter`
                );
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
              const availableChannels = guild.channels.cache
                .filter((ch) => ch.type === ChannelType.GuildText)
                .map((ch) => `${ch.name} (${ch.id})`)
                .join(", ");

              logger.warn(
                `Channel ${setting.channelId} not found in guild ${setting.guildId}. Available text channels: ${availableChannels}`
              );
              return;
            }

            const message = `🏆 **Match terminé !** 🏆`;

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
              `Sent score notification for match ${match.id} to channel ${setting.channelId} in guild ${setting.guildId}`
            );
          } catch (error) {
            logger.error(
              `Error sending score notification to guild ${setting.guildId}:`,
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

    // Mark match as announced (will be available after migration)
    // await prismaClient.match.update({
    //   where: { id: match.id },
    //   data: { status: "announced" },
    // });

    logger.info(`Sent score notification for match ${match.id}`);
  } catch (error) {
    logger.error(
      `Error sending score notification for match ${match.id}:`,
      error
    );
    throw error;
  }
}

async function sendNotificationForMatch(match: any, guildSettings: any[]) {
  try {
    logger.info(
      `Sending 30-minute notification for match ${match.id} (${match.kcTeam} vs ${match.opponent})`
    );

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
              logger.debug(
                `Skipping match ${match.id} for guild ${setting.guildId} - pre-match notifications disabled`
              );
              return;
            }

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

            try {
              await guild.fetch();
            } catch (error) {
              logger.warn(`Failed to fetch guild ${setting.guildId}:`, error);
            }

            const channel = guild.channels.cache.get(
              setting.channelId
            ) as TextChannel;
            if (!channel) {
              const availableChannels = guild.channels.cache
                .filter((ch) => ch.type === ChannelType.GuildText)
                .map((ch) => `${ch.name} (${ch.id})`)
                .join(", ");

              logger.warn(
                `Channel ${setting.channelId} not found in guild ${setting.guildId}. Available text channels: ${availableChannels}`
              );
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
