import { Client, GatewayIntentBits } from "discord.js";
import { config } from "dotenv";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { StatsManager } from "../utils/statsManager";

config();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
});

async function updateGuildStats() {
  try {
    logger.info("Starting guild stats update...");

    const guilds = client.guilds.cache;

    for (const [guildId, guild] of guilds) {
      try {
        await StatsManager.ensureGuildExists(
          guildId,
          guild.name,
          guild.memberCount
        );

        logger.info(
          `Updated stats for guild: ${guild.name} (${guild.memberCount} members)`
        );
      } catch (error) {
        logger.error(`Error updating stats for guild ${guildId}:`, error);
      }
    }

    logger.info("Guild stats update completed");
  } catch (error) {
    logger.error("Error in updateGuildStats:", error);
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
