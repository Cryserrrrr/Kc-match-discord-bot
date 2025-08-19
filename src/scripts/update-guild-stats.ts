import { Client, GatewayIntentBits } from "discord.js";
import { config } from "dotenv";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { StatsManager } from "../utils/statsManager";
import { withRetry, withTimeout } from "../utils/retryUtils";

config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

async function updateGuildStats() {
  try {
    logger.info("Starting guild stats update...");

    const guilds = client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        const fetchedGuild = await withRetry(() => guild.fetch(), {
          maxRetries: 3,
          initialDelay: 1000,
        });

        await withRetry(
          () =>
            StatsManager.ensureGuildExists(
              guildId,
              fetchedGuild.name,
              fetchedGuild.memberCount
            ),
          { maxRetries: 3, initialDelay: 1000 }
        );

        logger.info(
          `Updated stats for guild: ${fetchedGuild.name} (${fetchedGuild.memberCount} members)`
        );
      } catch (error) {
        logger.error(`Error updating stats for guild ${guildId}:`, error);

        try {
          await withRetry(
            () =>
              StatsManager.ensureGuildExists(
                guildId,
                guild.name,
                guild.memberCount || 0
              ),
            { maxRetries: 2, initialDelay: 2000 }
          );
          logger.info(`Updated stats for guild ${guildId} using cached data`);
        } catch (fallbackError) {
          logger.error(
            `Fallback update failed for guild ${guildId}:`,
            fallbackError
          );
        }
      }
    }

    await fillMissingGuildData();

    logger.info("Guild stats update completed");
  } catch (error) {
    logger.error("Error in updateGuildStats:", error);
  }
}

async function fillMissingGuildData() {
  try {
    logger.info("Checking for guilds with missing data...");

    const [nullNamesCount, nullUpdatedAtCount, nullMemberCountCount] =
      await withRetry(
        () =>
          Promise.all([
            prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE name IS NULL`,
            prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "updatedAt" IS NULL`,
            prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "memberCount" IS NULL`,
          ]),
        { maxRetries: 3, initialDelay: 1000 }
      );

    const totalMissingData =
      (nullNamesCount as any)[0]?.count +
      (nullUpdatedAtCount as any)[0]?.count +
      (nullMemberCountCount as any)[0]?.count;

    logger.info(
      `Found ${totalMissingData} total missing data fields across all guilds`
    );

    if (totalMissingData === 0) {
      logger.info("No guilds with missing data found. All data is up to date.");
      return;
    }

    if ((nullNamesCount as any)[0]?.count > 0) {
      const result = await withRetry(
        () => prisma.$executeRaw`
          UPDATE guild_settings 
          SET name = 'Unknown Guild' 
          WHERE name IS NULL
        `,
        { maxRetries: 3, initialDelay: 1000 }
      );
      logger.info(`Updated ${result} guilds with missing names`);
    }

    if ((nullUpdatedAtCount as any)[0]?.count > 0) {
      const result = await withRetry(
        () => prisma.$executeRaw`
          UPDATE guild_settings 
          SET "updatedAt" = NOW() 
          WHERE "updatedAt" IS NULL
        `,
        { maxRetries: 3, initialDelay: 1000 }
      );
      logger.info(`Updated ${result} guilds with missing updatedAt`);
    }

    if ((nullMemberCountCount as any)[0]?.count > 0) {
      const result = await withRetry(
        () => prisma.$executeRaw`
          UPDATE guild_settings 
          SET "memberCount" = 0 
          WHERE "memberCount" IS NULL
        `,
        { maxRetries: 3, initialDelay: 1000 }
      );
      logger.info(`Updated ${result} guilds with missing memberCount`);
    }

    const [
      remainingNullNames,
      remainingNullUpdatedAt,
      remainingNullMemberCount,
    ] = await withRetry(
      () =>
        Promise.all([
          prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE name IS NULL`,
          prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "updatedAt" IS NULL`,
          prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "memberCount" IS NULL`,
        ]),
      { maxRetries: 3, initialDelay: 1000 }
    );

    const totalRemaining =
      (remainingNullNames as any)[0]?.count +
      (remainingNullUpdatedAt as any)[0]?.count +
      (remainingNullMemberCount as any)[0]?.count;

    if (totalRemaining === 0) {
      logger.info("✅ All missing guild data has been successfully filled!");
    } else {
      logger.warn(
        "⚠️ Some guilds still have missing data. Manual intervention may be required."
      );
    }
  } catch (error) {
    logger.error("Error filling missing guild data:", error);
    throw error;
  }
}

async function cleanupOldStats() {
  try {
    logger.info("Starting cleanup of old statistics...");

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedPerformanceMetrics = await withRetry(
      () =>
        prisma.performanceMetric.deleteMany({
          where: {
            executedAt: {
              lt: thirtyDaysAgo,
            },
          },
        }),
      { maxRetries: 3, initialDelay: 1000 }
    );

    logger.info(
      `Cleaned up ${deletedPerformanceMetrics.count} old performance metrics`
    );
  } catch (error) {
    logger.error("Error in cleanupOldStats:", error);
  }
}

async function main() {
  try {
    logger.info("Starting guild statistics update script...");

    const scriptTimeout = setTimeout(() => {
      logger.warn("Script timeout reached, forcing exit...");
      process.exit(1);
    }, 5 * 60 * 1000);

    await withRetry(() => client.login(process.env.DISCORD_TOKEN), {
      maxRetries: 3,
      initialDelay: 2000,
    });

    logger.info("Bot logged in, starting statistics update...");

    await withRetry(
      () => new Promise((resolve) => client.once("ready", resolve)),
      { maxRetries: 3, initialDelay: 2000 }
    );

    await updateGuildStats();

    await cleanupOldStats();

    logger.info("Statistics update completed successfully");

    clearTimeout(scriptTimeout);
  } catch (error) {
    logger.error("Error in main function:", error);
  } finally {
    try {
      logger.info("Cleaning up connections...");

      await Promise.race([
        client.destroy(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);

      await Promise.race([
        prisma.$disconnect(),
        new Promise((resolve) => setTimeout(resolve, 5000)),
      ]);

      logger.info("Cleanup completed");
    } catch (cleanupError) {
      logger.error("Error during cleanup:", cleanupError);
    }
  }
}

if (require.main === module) {
  const gracefulShutdown = (signal: string) => {
    logger.info(`Received ${signal}, shutting down gracefully...`);
    process.exit(0);
  };

  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));

  main()
    .then(() => {
      logger.info("Script completed successfully, exiting...");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Unhandled error in statistics update script:", error);
      process.exit(1);
    });
}

export { updateGuildStats, cleanupOldStats };
