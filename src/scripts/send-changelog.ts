import { config } from "dotenv";
import { ClientManager } from "../utils/clientManager";
import { logger } from "../utils/logger";
import { isUpdateNotificationsEnabled } from "../utils/guildFilters";
import { sendChangelogNotification } from "../utils/notificationUtils";

config();

async function sendChangelogs() {
  const prisma = ClientManager.getPrismaClient();
  const client = await ClientManager.getDiscordClient();

  try {
    logger.info("Starting changelog distribution...");

    const newChangelogs = await prisma.changeLog.findMany({
      where: {
        status: "new",
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    if (newChangelogs.length === 0) {
      logger.info("No new changelogs to send");
      return;
    }

    logger.info(`Found ${newChangelogs.length} new changelogs to send`);

    const allGuilds = await prisma.guildSettings.findMany();
    const guildsWithNotifications = allGuilds.filter(
      isUpdateNotificationsEnabled
    );

    logger.info(
      `Found ${guildsWithNotifications.length} guilds with update notifications enabled`
    );

    let sentCount = 0;
    let errorCount = 0;

    for (const changelog of newChangelogs) {
      logger.info(
        `Processing changelog: ${changelog.text.substring(0, 50)}...`
      );

      const { sentCount: changelogSentCount, errorCount: changelogErrorCount } =
        await sendChangelogNotification(
          client,
          guildsWithNotifications,
          changelog.text
        );

      sentCount += changelogSentCount;
      errorCount += changelogErrorCount;

      await prisma.changeLog.update({
        where: { id: changelog.id },
        data: { status: "announced" },
      });

      logger.info(`Updated changelog ${changelog.id} status to announced`);
    }

    logger.info(
      `Changelog distribution completed. ${sentCount} messages sent, ${errorCount} errors`
    );
  } catch (error) {
    logger.error("Error during changelog distribution:", error);
  } finally {
    await ClientManager.cleanup();
  }
}

sendChangelogs()
  .then(() => {
    logger.info("Changelog script completed");
    process.exit(0);
  })
  .catch((error) => {
    logger.error("Fatal error:", error);
    process.exit(1);
  });
