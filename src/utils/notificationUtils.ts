import { Client, TextChannel, ChannelType } from "discord.js";
import { logger } from "./logger";
import { formatRoleMentions } from "./roleMentions";
import { GuildSettings, getPingRoles } from "./guildFilters";
import { withRetry } from "./retryUtils";

export interface NotificationOptions {
  content?: string;
  embeds?: any[];
  timeoutMs?: number;
}

export interface MatchData {
  id: string;
  kcTeam: string;
  kcId: string;
  opponent: string;
  opponentImage?: string;
  tournamentName: string;
  leagueName: string;
  leagueImage?: string;
  serieName: string;
  numberOfGames: number;
  beginAt: Date;
  score?: string;
}

export async function sendNotificationToGuild(
  client: Client,
  guildSettings: GuildSettings,
  options: NotificationOptions
): Promise<boolean> {
  try {
    const guild = client.guilds.cache.get(guildSettings.guildId);
    if (!guild) {
      logger.warn(`Guild ${guildSettings.guildId} not found`);
      return false;
    }

    try {
      await guild.fetch();
    } catch (error) {
      logger.warn(`Failed to fetch guild ${guildSettings.guildId}:`, error);
      return false;
    }

    const channel = guild.channels.cache.get(
      guildSettings.channelId
    ) as TextChannel;

    if (!channel) {
      const availableChannels = guild.channels.cache
        .filter((ch) => ch.type === ChannelType.GuildText)
        .map((ch) => `${ch.name} (${ch.id})`)
        .join(", ");

      logger.warn(
        `Channel ${guildSettings.channelId} not found in guild ${guildSettings.guildId}. Available text channels: ${availableChannels}`
      );
      return false;
    }

    const timeoutMs = options.timeoutMs || 10000;

    await withRetry(
      async () => {
        await Promise.race([
          channel.send({
            content: options.content,
            embeds: options.embeds,
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Send timeout")), timeoutMs)
          ),
        ]);
      },
      { maxRetries: 3, initialDelay: 1000 }
    );

    logger.info(
      `Sent notification to channel ${guildSettings.channelId} in guild ${guildSettings.guildId}`
    );
    return true;
  } catch (error) {
    logger.error(
      `Error sending notification to guild ${guildSettings.guildId}:`,
      error
    );
    return false;
  }
}

export async function sendMatchNotification(
  client: Client,
  guildSettings: GuildSettings,
  match: MatchData,
  embed: any,
  notificationType: "prematch" | "score" | "daily"
): Promise<boolean> {
  const pingRoles = getPingRoles(guildSettings);
  const roleMentions = formatRoleMentions(pingRoles);

  let message = "";
  if (pingRoles.length > 0) {
    message += `${roleMentions}\n`;
  }

  switch (notificationType) {
    case "prematch":
      message += "⏰ **Match dans 30 minutes !** ⏰";
      break;
    case "score":
      message += "🏁 **Match terminé !** 🏁";
      break;
    case "daily":
      message += "Match du jour !";
      break;
  }

  return sendNotificationToGuild(client, guildSettings, {
    content: message,
    embeds: [embed],
  });
}

export async function sendNotificationsToMultipleGuilds(
  client: Client,
  guildSettingsList: GuildSettings[],
  options: NotificationOptions
): Promise<{ success: number; failed: number }> {
  const results = await Promise.allSettled(
    guildSettingsList.map((settings) =>
      sendNotificationToGuild(client, settings, options)
    )
  );

  const success = results.filter(
    (result) => result.status === "fulfilled" && result.value === true
  ).length;
  const failed = results.length - success;

  return { success, failed };
}

export async function sendMatchNotificationsToMultipleGuilds(
  client: Client,
  guildSettingsList: GuildSettings[],
  match: MatchData,
  embed: any,
  notificationType: "prematch" | "score" | "daily"
): Promise<{ success: number; failed: number }> {
  const results = await Promise.allSettled(
    guildSettingsList.map((settings) =>
      sendMatchNotification(client, settings, match, embed, notificationType)
    )
  );

  const success = results.filter(
    (result) => result.status === "fulfilled" && result.value === true
  ).length;
  const failed = results.length - success;

  return { success, failed };
}
