import { Client, GatewayIntentBits } from "discord.js";
import { config } from "dotenv";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { StatsManager } from "../utils/statsManager";

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
        const fetchedGuild = await guild.fetch();

        await StatsManager.ensureGuildExists(
          guildId,
          fetchedGuild.name,
          fetchedGuild.memberCount
        );

        logger.info(
          `Updated stats for guild: ${fetchedGuild.name} (${fetchedGuild.memberCount} members)`
        );
      } catch (error) {
        logger.error(`Error updating stats for guild ${guildId}:`, error);

        try {
          await StatsManager.ensureGuildExists(
            guildId,
            guild.name,
            guild.memberCount || 0
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
      await Promise.all([
        prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE name IS NULL`,
        prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "updatedAt" IS NULL`,
        prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "memberCount" IS NULL`,
      ]);

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
      const result = await prisma.$executeRaw`
        UPDATE guild_settings 
        SET name = 'Unknown Guild' 
        WHERE name IS NULL
      `;
      logger.info(`Updated ${result} guilds with missing names`);
    }

    if ((nullUpdatedAtCount as any)[0]?.count > 0) {
      const result = await prisma.$executeRaw`
        UPDATE guild_settings 
        SET "updatedAt" = NOW() 
        WHERE "updatedAt" IS NULL
      `;
      logger.info(`Updated ${result} guilds with missing updatedAt`);
    }

    if ((nullMemberCountCount as any)[0]?.count > 0) {
      const result = await prisma.$executeRaw`
        UPDATE guild_settings 
        SET "memberCount" = 0 
        WHERE "memberCount" IS NULL
      `;
      logger.info(`Updated ${result} guilds with missing memberCount`);
    }

    const [
      remainingNullNames,
      remainingNullUpdatedAt,
      remainingNullMemberCount,
    ] = await Promise.all([
      prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE name IS NULL`,
      prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "updatedAt" IS NULL`,
      prisma.$queryRaw`SELECT COUNT(*) as count FROM guild_settings WHERE "memberCount" IS NULL`,
    ]);

    logger.info("Verification results:");
    logger.info(
      `- Guilds with null name: ${(remainingNullNames as any)[0]?.count}`
    );
    logger.info(
      `- Guilds with null updatedAt: ${
        (remainingNullUpdatedAt as any)[0]?.count
      }`
    );
    logger.info(
      `- Guilds with null memberCount: ${
        (remainingNullMemberCount as any)[0]?.count
      }`
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

    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    const deletedCommandStats = await prisma.commandStat.deleteMany({
      where: {
        executedAt: {
          lt: ninetyDaysAgo,
        },
      },
    });

    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const deletedPerformanceMetrics = await prisma.performanceMetric.deleteMany(
      {
        where: {
          executedAt: {
            lt: thirtyDaysAgo,
          },
        },
      }
    );

    logger.info(
      `Cleaned up ${deletedCommandStats.count} old command stats and ${deletedPerformanceMetrics.count} old performance metrics`
    );
  } catch (error) {
    logger.error("Error in cleanupOldStats:", error);
  }
}

async function main() {
  try {
    await client.login(process.env.DISCORD_TOKEN);

    logger.info("Bot logged in, starting statistics update...");

    await new Promise((resolve) => client.once("ready", resolve));

    await updateGuildStats();

    await cleanupOldStats();

    logger.info("Statistics update completed successfully");
  } catch (error) {
    logger.error("Error in main function:", error);
  } finally {
    await client.destroy();
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error("Unhandled error in statistics update script:", error);
    process.exit(1);
  });
}

export { updateGuildStats, cleanupOldStats };
