import { Client, ActivityType } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";
import { getStreamingUrl } from "../utils/casters";

export class StatusHandler {
  constructor(private client: Client, private prisma: PrismaClient) {}

  async updateBotStatus() {
    try {
      const liveMatch = await this.prisma.match.findFirst({
        where: { status: "live" },
        orderBy: { beginAt: "asc" },
      });

      if (liveMatch) {
        const statusText = `${liveMatch.kcTeam} vs ${liveMatch.opponent}`;
        const streamingUrl = getStreamingUrl(liveMatch.leagueName);

        if (streamingUrl) {
          this.client.user?.setActivity(statusText, {
            type: ActivityType.Streaming,
            url: streamingUrl,
          });
          logger.debug(
            `Updated bot status to: Streaming ${statusText} on ${streamingUrl}`
          );
        } else {
          this.client.user?.setActivity(statusText, {
            type: ActivityType.Streaming,
            url: "https://www.twitch.tv/kamet0",
          });
          logger.debug(
            `Updated bot status to: Streaming ${statusText} (no streaming URL found)`
          );
        }
      } else {
        this.client.user?.setPresence({ activities: [] });
        logger.debug("Cleared bot status - no live matches");
      }
    } catch (error) {
      logger.error("Error updating bot status:", error);
    }
  }

  startStatusUpdates() {
    this.updateBotStatus();
    setInterval(() => this.updateBotStatus(), 5 * 60 * 1000);
  }
}
