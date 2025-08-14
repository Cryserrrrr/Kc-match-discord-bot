import { createScoreEmbed } from "../utils/embedBuilder";
import { logger } from "../utils/logger";
import { ClientManager } from "../utils/clientManager";
import { withRetry } from "../utils/retryUtils";
import {
  GuildSettings,
  isTeamAllowed,
  isScoreNotificationsEnabled,
  getPingRoles,
} from "../utils/guildFilters";
import { sendMatchNotification } from "../utils/notificationUtils";
import dotenv from "dotenv";

dotenv.config();

let guildSettingsCache: any[] | null = null;
let lastCacheUpdate = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getGuildSettings(): Promise<GuildSettings[]> {
  const now = Date.now();

  if (guildSettingsCache && now - lastCacheUpdate < CACHE_DURATION) {
    return guildSettingsCache;
  }

  const prismaClient = ClientManager.getPrismaClient();
  guildSettingsCache = await prismaClient.guildSettings.findMany();

  lastCacheUpdate = now;
  logger.debug(
    `Updated guild settings cache with ${guildSettingsCache.length} entries`
  );

  return guildSettingsCache;
}

async function checkFinishedMatchesAndSendScoreNotifications() {
  const startTime = Date.now();

  try {
    logger.info(
      "🔍 Starting check for finished matches to send score notifications..."
    );

    await withRetry(async () => {
      const prismaClient = ClientManager.getPrismaClient();
      await prismaClient.$queryRaw`SELECT 1`;
    });

    // Connect to Discord once at the beginning
    const discordClient = await withRetry(async () => {
      logger.info("🔗 Connecting to Discord...");
      return await ClientManager.getDiscordClient();
    });
    logger.info("✅ Discord connection established");

    const finishedMatches = await withRetry(async () => {
      const prismaClient = ClientManager.getPrismaClient();

      return await prismaClient.match.findMany({
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
    });

    if (finishedMatches.length === 0) {
      logger.info("No finished matches to announce");
      return;
    }

    const guildSettings = await withRetry(async () => {
      return await getGuildSettings();
    });

    if (guildSettings.length === 0) {
      logger.warn("No guild settings found. No channels to announce to.");
      return;
    }

    const guildSettingsWithScoreNotifications = guildSettings.filter(
      (setting) => setting.enableScoreNotifications === true
    );

    if (guildSettingsWithScoreNotifications.length === 0) {
      logger.info("No guilds have score notifications enabled");
      return;
    }

    const scoreNotificationPromises = finishedMatches.map((match) =>
      sendScoreNotificationForMatch(
        match,
        guildSettingsWithScoreNotifications,
        discordClient
      )
    );

    const prismaClient = ClientManager.getPrismaClient();
    await prismaClient.match.updateMany({
      where: {
        id: {
          in: finishedMatches.map((match) => match.id),
        },
      },
      data: {
        status: "announced",
      },
    });

    await Promise.allSettled(scoreNotificationPromises);

    const executionTime = Date.now() - startTime;
    logger.info(
      `Finished checking and sending score notifications in ${executionTime}ms`
    );
  } catch (error) {
    logger.error("💥 CRITICAL ERROR - Script failed after all retries:", error);
    throw error;
  } finally {
    // Cleanup clients
    await ClientManager.cleanup();
  }
}

async function sendScoreNotificationForMatch(
  match: any,
  guildSettings: GuildSettings[],
  discordClient: any
) {
  try {
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
        score: match.score,
      });
    });

    const channelPromises = guildSettings.map(async (setting) => {
      await withRetry(
        async () => {
          try {
            if (!isTeamAllowed(match.kcId, setting)) {
              logger.debug(
                `Skipping score notification for match ${match.id} for guild ${setting.guildId} - team ${match.kcId} not in filter`
              );
              return;
            }

            await sendMatchNotification(
              discordClient,
              setting,
              match,
              embed,
              "score"
            );
          } catch (error) {
            logger.error(
              `Error sending score notification to guild ${setting.guildId}:`,
              error
            );
            throw error; // Re-throw to trigger retry
          }
        },
        { maxRetries: 3, initialDelay: 1000 }
      );
    });

    await Promise.allSettled(channelPromises);
  } catch (error) {
    logger.error(
      `Error sending score notification for match ${match.id}:`,
      error
    );
    throw error;
  }
}

export async function cleanup() {
  try {
    await ClientManager.cleanup();
    guildSettingsCache = null;
  } catch (error) {
    logger.error("Error during cleanup:", error);
  }
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

if (require.main === module) {
  checkFinishedMatchesAndSendScoreNotifications()
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

export { checkFinishedMatchesAndSendScoreNotifications };
