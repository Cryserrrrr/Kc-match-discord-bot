import { logger } from "./logger";

export interface GuildSettings {
  guildId: string;
  channelId: string;
  filteredTeams?: string[];
  pingRoles?: string[];
  enablePreMatchNotifications?: boolean;
  enableScoreNotifications?: boolean;
  enableUpdateNotifications?: boolean;
}

export function isTeamAllowed(
  kcId: string,
  guildSettings: GuildSettings | null
): boolean {
  if (!guildSettings) {
    logger.debug("No guild settings found, allowing all teams");
    return true;
  }

  const filteredTeams = guildSettings.filteredTeams || [];

  if (filteredTeams.length === 0) {
    return true;
  }

  const isAllowed = filteredTeams.includes(kcId);

  if (!isAllowed) {
    logger.debug(
      `Team ${kcId} not in filter for guild ${
        guildSettings.guildId
      }. Filtered teams: ${filteredTeams.join(", ")}`
    );
  }

  return isAllowed;
}

export function filterMatchesByGuild(
  matches: any[],
  guildSettings: GuildSettings | null
): any[] {
  if (!guildSettings) {
    return matches;
  }

  const filteredTeams = guildSettings.filteredTeams || [];

  if (filteredTeams.length === 0) {
    return matches;
  }

  return matches.filter((match) => filteredTeams.includes(match.kcId));
}

export function isPreMatchNotificationsEnabled(
  guildSettings: GuildSettings | null
): boolean {
  return guildSettings?.enablePreMatchNotifications === true;
}

export function isScoreNotificationsEnabled(
  guildSettings: GuildSettings | null
): boolean {
  return guildSettings?.enableScoreNotifications === true;
}

export function isUpdateNotificationsEnabled(
  guildSettings: GuildSettings | null
): boolean {
  return guildSettings?.enableUpdateNotifications !== false;
}

export function getPingRoles(guildSettings: GuildSettings | null): string[] {
  return guildSettings?.pingRoles || [];
}

export function hasValidConfiguration(
  guildSettings: GuildSettings | null
): boolean {
  return !!(guildSettings && guildSettings.channelId);
}
