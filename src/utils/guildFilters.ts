import { GuildSettings as PrismaGuildSettings } from "@prisma/client";

export type GuildSettings = PrismaGuildSettings;

export function isTeamAllowed(
  kcId: string,
  guildSettings: GuildSettings | null
): boolean {
  if (!guildSettings) {
    return true;
  }
  const filteredTeams = guildSettings.filteredTeams || [];
  if (filteredTeams.length === 0) {
    return true;
  }
  return filteredTeams.includes(kcId);
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

export function isTwitchNotificationsEnabled(
  guildSettings: GuildSettings | null
): boolean {
  return guildSettings?.enableTwitchNotifications !== false;
}

export function hasValidConfiguration(
  guildSettings: GuildSettings | null
): boolean {
  return !!(guildSettings && guildSettings.channelId);
}

export function getMatchAnnouncementRole(
  guildSettings: GuildSettings | null
): string | null {
  return guildSettings?.matchAnnouncementRole || null;
}

export function getTwitchLiveRole(
  guildSettings: GuildSettings | null
): string | null {
  return guildSettings?.twitchLiveRole || null;
}

export function getTeamRole(
  teamId: string,
  guildSettings: GuildSettings | null
): string | null {
  if (!guildSettings?.teamRoles) {
    return null;
  }
  const teamRoles = guildSettings.teamRoles as Record<string, string>;
  return teamRoles[teamId] || null;
}

export function getMatchRolesToPing(
  teamId: string,
  guildSettings: GuildSettings | null
): string[] {
  const roles: string[] = [];
  const matchRole = getMatchAnnouncementRole(guildSettings);
  if (matchRole) {
    roles.push(matchRole);
  }
  const teamRole = getTeamRole(teamId, guildSettings);
  if (teamRole && !roles.includes(teamRole)) {
    roles.push(teamRole);
  }
  return roles;
}

export function getTwitchRolesToPing(
  teamId: string,
  guildSettings: GuildSettings | null
): string[] {
  const roles: string[] = [];
  const twitchRole = getTwitchLiveRole(guildSettings);
  if (twitchRole) {
    roles.push(twitchRole);
  }
  const teamRole = getTeamRole(teamId, guildSettings);
  if (teamRole && !roles.includes(teamRole)) {
    roles.push(teamRole);
  }
  return roles;
}

export function getPingRoles(guildSettings: GuildSettings | null): string[] {
  return guildSettings?.pingRoles || [];
}
