import { Client, TextChannel } from "discord.js";
import { logger } from "./logger";
import { formatRoleMentions } from "./roleMentions";
import {
  GuildSettings,
  isTeamAllowed,
  isScoreNotificationsEnabled,
  isTwitchNotificationsEnabled,
  getMatchRolesToPing,
  getTwitchRolesToPing,
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
    return null;
  }
  try {
    await guild.fetch();
  } catch {
    return null;
  }
  const channel = guild.channels.cache.get(channelId) as TextChannel;
  if (!channel) {
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
  const rolesToPing = getMatchRolesToPing(match.kcId, guildSettings);
  const roleMentions = formatRoleMentions(rolesToPing);
  let message = "";
  if (rolesToPing.length > 0) {
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
        const rolesToPing = getMatchRolesToPing(match.kcId, setting);
        const roleMentions = formatRoleMentions(rolesToPing);
        const message =
          rolesToPing.length > 0
            ? `${roleMentions}\n🚨 **Le match commence !** 🚨`
            : `🚨 **Le match commence !** 🚨`;
        await sendMessageWithTimeout(channel, message, [embed]);
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
        const rolesToPing = getMatchRolesToPing(match.kcId, setting);
        const roleMentions = formatRoleMentions(rolesToPing);
        const message =
          rolesToPing.length > 0
            ? `${roleMentions}\n **Match reporté !**`
            : ` **Match reporté !**`;
        await sendMessageWithTimeout(channel, message, [embed]);
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
        if (settings.filteredTeams && settings.filteredTeams.length > 0) {
          filteredMatches = matches.filter((match) =>
            settings.filteredTeams.includes(match.kcId)
          );
        }
        if (filteredMatches.length === 0) {
          continue;
        }
        const allTeamIds = [...new Set(filteredMatches.map((m) => m.kcId))];
        const allRoles: string[] = [];
        for (const teamId of allTeamIds) {
          const roles = getMatchRolesToPing(teamId, settings);
          for (const role of roles) {
            if (!allRoles.includes(role)) {
              allRoles.push(role);
            }
          }
        }
        const roleMentions = formatRoleMentions(allRoles);
        const pingMessage =
          allRoles.length > 0
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
            logger.error(`Error sending match ${match.id}:`, matchError);
          }
        }
        hasSuccessfulAnnouncements = true;
        await addDelayIfNotLast(i, guildSettings.length);
      } catch (error) {
        logger.error(
          `Failed to announce matches in guild ${settings.guildId}:`,
          error
        );
      }
    }
    return hasSuccessfulAnnouncements;
  } catch (error) {
    logger.error("Error announcing matches:", error);
    throw error;
  }
}

export async function sendNoMatchesAnnouncement(
  client: Client,
  guildSettings: any[]
): Promise<void> {
  try {
    if (guildSettings.length === 0) {
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
        const { channel } = result;
        await channel.send("🔔 Pas de match aujourd'hui");
        await addDelayIfNotLast(i, guildSettings.length);
      } catch (error) {
        logger.error(
          `Failed to send "no matches" message in guild ${settings.guildId}:`,
          error
        );
      }
    }
  } catch (error) {
    logger.error("Error sending no matches message:", error);
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
        continue;
      }
      if ("send" in channel) {
        await channel.send(changelogText);
      } else {
        continue;
      }
      sentCount++;
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
    logger.info(`Processing Twitch notification for ${playerName} (${teamName}, teamId: ${teamId})`);
    const eligibleGuilds = guildSettings.filter((setting) => {
      if (!isTwitchNotificationsEnabled(setting)) {
        return false;
      }
      if (!isTeamAllowed(teamId, setting)) {
        return false;
      }
      return true;
    });
    logger.info(`Found ${eligibleGuilds.length} eligible guilds for Twitch notification (total: ${guildSettings.length})`);
    if (eligibleGuilds.length === 0) {
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
        if (!result) {
          logger.warn(`Could not get channel for guild ${setting.guildId}`);
          continue;
        }
        const { channel } = result;
        const rolesToPing = getTwitchRolesToPing(teamId, setting);
        const roleMentions = formatRoleMentions(rolesToPing);
        const message =
          rolesToPing.length > 0
            ? `${roleMentions}\n🔴 **${playerName} est en live sur Twitch !**`
            : `🔴 **${playerName} est en live sur Twitch !**`;
        await sendMessageWithTimeout(channel, message, [embed]);
        logger.info(`Sent Twitch notification for ${playerName} to guild ${setting.guildId}`);
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

