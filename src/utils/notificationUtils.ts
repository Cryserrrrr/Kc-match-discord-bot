import { Client, TextChannel, ChannelType } from "discord.js";
import { logger } from "./logger";
import { formatRoleMentions } from "./roleMentions";
import {
  GuildSettings,
  getPingRoles,
  isTeamAllowed,
  isScoreNotificationsEnabled,
  isTwitchNotificationsEnabled,
} from "./guildFilters";
import { withRetry } from "./retryUtils";
import {
  createMatchEmbed,
  createScoreEmbed,
  createRescheduleEmbed,
  createStreamEmbed,
  StreamData,
} from "./embedBuilder";
import { TwitchService, TwitchStream } from "../services/twitch";

export const DISCORD_RATE_LIMIT_DELAY = 500;

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

async function getGuildAndChannel(
  client: Client,
  guildId: string,
  channelId: string
) {
  const guild = client.guilds.cache.get(guildId);
  if (!guild) {
    logger.warn(`Guild ${guildId} not found`);
    return null;
  }

  try {
    await guild.fetch();
  } catch (error) {
    logger.warn(`Failed to fetch guild ${guildId}:`, error);
    return null;
  }

  const channel = guild.channels.cache.get(channelId) as TextChannel;
  if (!channel) {
    logger.warn(`Channel not found in guild ${guildId}`);
    return null;
  }

  return { guild, channel };
}

async function sendMessageWithTimeout(
  channel: TextChannel,
  content: string,
  embeds?: any[],
  timeoutMs: number = 10000
) {
  await Promise.race([
    channel.send({ content, embeds }),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error("Send timeout")), timeoutMs)
    ),
  ]);
}

async function addDelayIfNotLast(index: number, total: number) {
  if (index < total - 1) {
    await new Promise((resolve) =>
      setTimeout(resolve, DISCORD_RATE_LIMIT_DELAY)
    );
  }
}

function filterEligibleGuilds(
  guildSettings: any[],
  match: any,
  notificationType: "prematch" | "score" | "reschedule"
) {
  return guildSettings.filter((setting) => {
    if (
      notificationType === "prematch" &&
      !setting.enablePreMatchNotifications
    ) {
      return false;
    }
    if (notificationType === "score" && !isScoreNotificationsEnabled(setting)) {
      return false;
    }
    if (
      notificationType === "reschedule" &&
      !setting.enablePreMatchNotifications
    ) {
      return false;
    }

    if (setting.filteredTeams && setting.filteredTeams.length > 0) {
      if (!setting.filteredTeams.includes(match.kcId)) {
        return false;
      }
    }

    if (notificationType === "score" && !isTeamAllowed(match.kcId, setting)) {
      return false;
    }

    return true;
  });
}

export async function sendNotificationToGuild(
  client: Client,
  guildSettings: GuildSettings,
  options: NotificationOptions
): Promise<boolean> {
  try {
    const result = await getGuildAndChannel(
      client,
      guildSettings.guildId,
      guildSettings.channelId
    );
    if (!result) return false;

    const { channel } = result;
    const timeoutMs = options.timeoutMs || 10000;

    await withRetry(
      async () => {
        await sendMessageWithTimeout(
          channel,
          options.content || "",
          options.embeds,
          timeoutMs
        );
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
  notificationType: "score" | "daily"
): Promise<boolean> {
  const pingRoles = getPingRoles(guildSettings);
  const roleMentions = formatRoleMentions(pingRoles);

  let message = "";
  if (pingRoles.length > 0) {
    message += `${roleMentions}\n`;
  }

  switch (notificationType) {
    case "score":
      message += "🏁 **Match terminé !**";
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
  let success = 0;
  let failed = 0;

  for (let i = 0; i < guildSettingsList.length; i++) {
    const settings = guildSettingsList[i];
    try {
      const result = await sendNotificationToGuild(client, settings, options);
      if (result) {
        success++;
      } else {
        failed++;
      }
      await addDelayIfNotLast(i, guildSettingsList.length);
    } catch (error) {
      logger.error(
        `Error sending notification to guild ${settings.guildId}:`,
        error
      );
      failed++;
    }
  }

  return { success, failed };
}

export async function sendMatchNotificationsToMultipleGuilds(
  client: Client,
  guildSettingsList: GuildSettings[],
  match: MatchData,
  embed: any,
  notificationType: "score" | "daily"
): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (let i = 0; i < guildSettingsList.length; i++) {
    const settings = guildSettingsList[i];
    try {
      const result = await sendMatchNotification(
        client,
        settings,
        match,
        embed,
        notificationType
      );
      if (result) {
        success++;
      } else {
        failed++;
      }
      await addDelayIfNotLast(i, guildSettingsList.length);
    } catch (error) {
      logger.error(
        `Error sending match notification to guild ${settings.guildId}:`,
        error
      );
      failed++;
    }
  }

  return { success, failed };
}

export async function sendLastMinuteNotification(
  client: Client,
  match: any,
  guildSettings: any[]
): Promise<void> {
  try {
    const embed = await createMatchEmbed({
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

    const eligibleGuilds = filterEligibleGuilds(
      guildSettings,
      match,
      "prematch"
    );

    if (eligibleGuilds.length === 0) {
      logger.info("No eligible guilds for last minute notification");
      return;
    }

    for (let i = 0; i < eligibleGuilds.length; i++) {
      const setting = eligibleGuilds[i];
      try {
        const result = await getGuildAndChannel(
          client,
          setting.guildId,
          setting.channelId
        );
        if (!result) continue;

        const { channel } = result;
        const pingRoles = (setting as any).pingRoles || [];
        const roleMentions = formatRoleMentions(pingRoles);
        const message =
          pingRoles.length > 0
            ? `${roleMentions}\n🚨 **Le match commence !** 🚨`
            : `🚨 **Le match commence !** 🚨`;

        await sendMessageWithTimeout(channel, message, [embed]);

        logger.info(
          `Sent last minute notification for match ${match.id} to guild ${setting.guildId}`
        );

        await addDelayIfNotLast(i, eligibleGuilds.length);
      } catch (error) {
        logger.error(
          `Error sending last minute notification to guild ${setting.guildId}:`,
          error
        );
      }
    }
  } catch (error) {
    logger.error(
      `Error sending last minute notification for match ${match.id}:`,
      error
    );
  }
}

export async function sendScoreNotification(
  client: Client,
  match: any,
  guildSettings: GuildSettings[]
): Promise<void> {
  try {
    const embed = await createScoreEmbed({
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

    const eligibleGuilds = filterEligibleGuilds(guildSettings, match, "score");

    if (eligibleGuilds.length === 0) {
      logger.info("No eligible guilds for score notification");
      return;
    }

    for (let i = 0; i < eligibleGuilds.length; i++) {
      const setting = eligibleGuilds[i];
      try {
        await sendMatchNotification(client, setting, match, embed, "score");
        await addDelayIfNotLast(i, eligibleGuilds.length);
      } catch (error) {
        logger.error(
          `Error sending score notification to guild ${setting.guildId}:`,
          error
        );
      }
    }
  } catch (error) {
    logger.error(
      `Error sending score notification for match ${match.id}:`,
      error
    );
  }
}

export async function sendRescheduleNotification(
  client: Client,
  match: any,
  originalTime: Date,
  guildSettings: any[]
): Promise<void> {
  try {
    const embed = await createRescheduleEmbed({
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
      originalTime: originalTime,
    });

    const eligibleGuilds = filterEligibleGuilds(
      guildSettings,
      match,
      "reschedule"
    );

    if (eligibleGuilds.length === 0) {
      logger.info("No eligible guilds for reschedule notification");
      return;
    }

    for (let i = 0; i < eligibleGuilds.length; i++) {
      const setting = eligibleGuilds[i];
      try {
        const result = await getGuildAndChannel(
          client,
          setting.guildId,
          setting.channelId
        );
        if (!result) continue;

        const { channel } = result;
        const pingRoles = (setting as any).pingRoles || [];
        const roleMentions = formatRoleMentions(pingRoles);
        const message =
          pingRoles.length > 0
            ? `${roleMentions}\n **Match reporté !**`
            : ` **Match reporté !**`;

        await sendMessageWithTimeout(channel, message, [embed]);

        logger.info(
          `Sent reschedule notification for match ${match.id} to guild ${setting.guildId}`
        );

        await addDelayIfNotLast(i, eligibleGuilds.length);
      } catch (error) {
        logger.error(
          `Error sending reschedule notification to guild ${setting.guildId}:`,
          error
        );
      }
    }
  } catch (error) {
    logger.error(
      `Error sending reschedule notification for match ${match.id}:`,
      error
    );
  }
}

export async function sendDailyMatchAnnouncement(
  client: Client,
  guildSettings: any[],
  matches: any[]
): Promise<boolean> {
  try {
    if (guildSettings.length === 0) {
      logger.info(
        "⚠️  No guild settings found - no channels configured for announcements"
      );
      return false;
    }

    let hasSuccessfulAnnouncements = false;

    for (let i = 0; i < guildSettings.length; i++) {
      const settings = guildSettings[i];
      try {
        const result = await getGuildAndChannel(
          client,
          settings.guildId,
          settings.channelId
        );
        if (!result) continue;

        const { guild, channel } = result;
        let filteredMatches = matches;

        if (
          (settings as any).filteredTeams &&
          (settings as any).filteredTeams.length > 0
        ) {
          filteredMatches = matches.filter((match) =>
            (settings as any).filteredTeams.includes(match.kcId)
          );
        }

        if (filteredMatches.length === 0) {
          logger.info(
            `⏭️  No matches to announce for guild ${guild.name} (filtered)`
          );
          continue;
        }

        const pingRoles = (settings as any).pingRoles || [];
        const roleMentions = formatRoleMentions(pingRoles);
        const pingMessage =
          pingRoles.length > 0
            ? `${roleMentions} Match(s) des prochaines 24h !`
            : "Match(s) des prochaines 24h !";

        await channel.send(pingMessage);

        for (const match of filteredMatches) {
          try {
            const embed = await createMatchEmbed({
              kcTeam: match.kcTeam,
              kcId: match.kcId,
              opponent: match.opponent,
              opponentImage: match.opponentImage,
              tournamentName: match.tournamentName,
              leagueName: match.leagueName,
              leagueImage: match.leagueImage,
              serieName: match.serieName,
              numberOfGames: match.numberOfGames,
              beginAt: match.beginAt,
            });

            await channel.send({ embeds: [embed] });

            if (filteredMatches.indexOf(match) < filteredMatches.length - 1) {
              await new Promise((resolve) => setTimeout(resolve, 1000));
            }
          } catch (matchError) {
            logger.error(`❌ Error sending match ${match.id}:`, matchError);
          }
        }

        logger.info(
          `✅ Successfully announced ${filteredMatches.length} matches in guild ${guild.name}`
        );
        hasSuccessfulAnnouncements = true;

        await addDelayIfNotLast(i, guildSettings.length);
      } catch (error) {
        logger.error(
          `❌ Failed to announce matches in guild ${settings.guildId}:`,
          error
        );
      }
    }

    return hasSuccessfulAnnouncements;
  } catch (error) {
    logger.error("❌ Error announcing matches:", error);
    throw error;
  }
}

export async function sendNoMatchesAnnouncement(
  client: Client,
  guildSettings: any[]
): Promise<void> {
  try {
    if (guildSettings.length === 0) {
      logger.info(
        "⚠️  No guild settings found - no channels configured for announcements"
      );
      return;
    }

    for (let i = 0; i < guildSettings.length; i++) {
      const settings = guildSettings[i];
      try {
        const result = await getGuildAndChannel(
          client,
          settings.guildId,
          settings.channelId
        );
        if (!result) continue;

        const { guild, channel } = result;
        await channel.send("🔔 Pas de match aujourd'hui");
        logger.info(`✅ Sent "no matches" message in guild ${guild.name}`);

        await addDelayIfNotLast(i, guildSettings.length);
      } catch (error) {
        logger.error(
          `❌ Failed to send "no matches" message in guild ${settings.guildId}:`,
          error
        );
      }
    }
  } catch (error) {
    logger.error("❌ Error sending no matches message:", error);
    throw error;
  }
}

export async function sendChangelogNotification(
  client: Client,
  guildSettings: any[],
  changelogText: string
): Promise<{ sentCount: number; errorCount: number }> {
  let sentCount = 0;
  let errorCount = 0;

  for (let i = 0; i < guildSettings.length; i++) {
    const guild = guildSettings[i];
    try {
      const channel = await client.channels.fetch(guild.channelId);

      if (!channel || !channel.isTextBased()) {
        logger.warn(
          `Invalid channel ${guild.channelId} for guild ${guild.guildId}`
        );
        continue;
      }

      if ("send" in channel) {
        await channel.send(changelogText);
      } else {
        logger.warn(
          `Channel ${guild.channelId} does not support sending messages`
        );
        continue;
      }

      sentCount++;
      logger.info(`Sent changelog to guild ${guild.guildId} (${guild.name})`);

      await addDelayIfNotLast(i, guildSettings.length);
    } catch (error) {
      errorCount++;
      logger.error(`Error sending changelog to guild ${guild.guildId}:`, error);
    }
  }

  return { sentCount, errorCount };
}

export async function sendTwitchStreamNotification(
  client: Client,
  guildSettings: GuildSettings[],
  stream: TwitchStream,
  playerName: string,
  teamId: string,
  teamName: string,
  twitchService: TwitchService
): Promise<void> {
  try {
    const eligibleGuilds = guildSettings.filter((setting) => {
      if (!isTwitchNotificationsEnabled(setting)) {
        return false;
      }
      if (!isTeamAllowed(teamId, setting)) {
        return false;
      }
      return true;
    });

    if (eligibleGuilds.length === 0) {
      logger.info(
        `No eligible guilds for Twitch stream notification (${playerName} - ${teamName})`
      );
      return;
    }

    const streamData: StreamData = {
      title: stream.title,
      playerName: playerName,
      teamName: teamName,
      teamId: teamId,
      userLogin: stream.user_login,
      userName: stream.user_name,
      userId: stream.user_id,
      gameName: stream.game_name,
      viewerCount: stream.viewer_count,
      thumbnailUrl: stream.thumbnail_url,
      startedAt: new Date(stream.started_at),
    };

    const embed = await createStreamEmbed(streamData, twitchService);

    for (let i = 0; i < eligibleGuilds.length; i++) {
      const setting = eligibleGuilds[i];
      try {
        const result = await getGuildAndChannel(
          client,
          setting.guildId,
          setting.channelId
        );
        if (!result) continue;

        const { channel } = result;
        const message = `🔴 **${playerName} est en live sur Twitch !**`;

        await sendMessageWithTimeout(channel, message, [embed]);

        logger.info(
          `Sent Twitch stream notification for ${playerName} (${teamName}) to guild ${setting.guildId}`
        );

        await addDelayIfNotLast(i, eligibleGuilds.length);
      } catch (error) {
        logger.error(
          `Error sending Twitch stream notification to guild ${setting.guildId}:`,
          error
        );
      }
    }
  } catch (error) {
    logger.error(
      `Error sending Twitch stream notification for ${playerName}:`,
      error
    );
  }
}
