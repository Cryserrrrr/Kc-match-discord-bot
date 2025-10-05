#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { config } from "dotenv";
import { logger } from "../utils/logger";
import {
  sendDailyMatchAnnouncement,
  sendNoMatchesAnnouncement,
} from "../utils/notificationUtils";
import { filterMatchesByGuild } from "../utils/guildFilters";
import { formatRoleMentions } from "../utils/roleMentions";
import { createMatchEmbed } from "../utils/embedBuilder";

config();

const MAX_RETRIES = 5;
const INITIAL_DELAY = 2000;
const MAX_DELAY = 60000;

async function withRetry<T>(
  fn: () => Promise<T>,
  maxRetries: number = MAX_RETRIES,
  initialDelay: number = INITIAL_DELAY
): Promise<T> {
  let lastError: Error;
  let delay = initialDelay;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      console.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        console.error(
          `💥 All ${maxRetries} attempts failed. Final error:`,
          lastError
        );
        throw lastError;
      }

      await new Promise((resolve) => setTimeout(resolve, delay));

      delay = Math.min(delay * 2, MAX_DELAY);
    }
  }

  throw lastError!;
}

async function hasNoMatchMessageBeenSent(
  prisma: PrismaClient,
  guildId: string
): Promise<boolean> {
  try {
    const guildSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
      select: { lastNoMatchMessageSent: true },
    });

    if (!guildSettings?.lastNoMatchMessageSent) {
      return false;
    } else {
      return true;
    }
  } catch (error) {
    logger.error(
      `Error checking no-match message status for guild ${guildId}:`,
      error
    );
    return false;
  }
}

async function markNoMatchMessageSent(
  prisma: PrismaClient,
  guildId: string
): Promise<void> {
  try {
    await prisma.guildSettings.update({
      where: { guildId },
      data: { lastNoMatchMessageSent: new Date() },
    });
  } catch (error) {
    logger.error(
      `Error marking no-match message sent for guild ${guildId}:`,
      error
    );
  }
}

async function clearNoMatchMessageFlag(
  prisma: PrismaClient,
  guildId: string
): Promise<void> {
  try {
    await prisma.guildSettings.update({
      where: { guildId },
      data: { lastNoMatchMessageSent: null },
    });
  } catch (error) {
    logger.error(
      `Error clearing no-match message flag for guild ${guildId}:`,
      error
    );
  }
}

async function main() {
  let prisma: PrismaClient | null = null;
  let client: Client | null = null;

  try {
    await withRetry(async () => {
      prisma = new PrismaClient();
      await prisma.$queryRaw`SELECT 1`;
    });

    await withRetry(async () => {
      client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      });

      const loginPromise = client.login(process.env.DISCORD_TOKEN);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Discord login timeout")), 30000)
      );

      await Promise.race([loginPromise, timeoutPromise]);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Client ready timeout"));
        }, 30000);

        client!.once("ready", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    });

    const matches = await withRetry(async () => {
      if (!prisma) throw new Error("Prisma client not initialized");
      return await getMatchesNext24Hours(prisma);
    });

    if (matches.length === 0) {
      logger.info("📭 No matches found for the next 24 hours in database");
      await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        const guildSettings = await prisma.guildSettings.findMany();
        await sendNoMatchesAnnouncementWithNextMatch(
          client,
          prisma,
          guildSettings
        );
      });
    } else {
      logger.info(
        `📅 Found ${matches.length} matches for the next 24 hours in database`
      );

      const hasAnnouncements = await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        const guildSettings = await prisma.guildSettings.findMany();
        return await sendDailyMatchAnnouncementWithReset(
          client,
          prisma,
          guildSettings,
          matches
        );
      });

      if (!hasAnnouncements) {
        logger.info(
          "📭 No guilds received match announcements - sending no matches message"
        );
        await withRetry(async () => {
          if (!client || !prisma) throw new Error("Clients not initialized");
          const guildSettings = await prisma.guildSettings.findMany();
          await sendNoMatchesAnnouncementWithNextMatch(
            client,
            prisma,
            guildSettings
          );
        });
      }
    }
  } catch (error) {
    logger.error("💥 CRITICAL ERROR - Script failed after all retries:", error);
    process.exit(1);
  } finally {
    try {
      if (prisma) {
        await (prisma as PrismaClient).$disconnect();
      }
      if (client) {
        await (client as Client).destroy();
      }
    } catch (cleanupError) {
      logger.error("❌ Error during cleanup:", cleanupError);
    }

    process.exit(0);
  }
}

async function getMatchesNext24Hours(prisma: PrismaClient) {
  const now = new Date();
  const dateMinusOne = new Date(now);
  dateMinusOne.setMinutes(dateMinusOne.getMinutes() - 1);

  const tomorrow = new Date(dateMinusOne);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const matches = await prisma.match.findMany({
      where: {
        beginAt: {
          gte: dateMinusOne,
          lte: tomorrow,
        },
      },
      orderBy: {
        beginAt: "asc",
      },
    });

    return matches;
  } catch (error) {
    logger.error("❌ Error fetching matches from database:", error);
    throw error;
  }
}

async function getNextMatchForGuild(prisma: PrismaClient, guildSettings: any) {
  const now = new Date();

  try {
    const allMatches = await prisma.match.findMany({
      where: {
        beginAt: {
          gte: now,
        },
        status: {
          in: ["not_started", "live"],
        },
      },
      orderBy: {
        beginAt: "asc",
      },
    });

    const filteredMatches = filterMatchesByGuild(allMatches, guildSettings);

    return filteredMatches.length > 0 ? filteredMatches[0] : null;
  } catch (error) {
    logger.error("❌ Error fetching next match for guild:", error);
    throw error;
  }
}

async function sendNoMatchesAnnouncementWithNextMatch(
  client: Client,
  prisma: PrismaClient,
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
        const guild = client.guilds.cache.get(settings.guildId);
        if (!guild) {
          logger.warn(`Guild ${settings.guildId} not found`);
          continue;
        }

        const channel = guild.channels.cache.get(
          settings.channelId
        ) as TextChannel;
        if (!channel) {
          logger.warn(`Channel not found in guild ${settings.guildId}`);
          continue;
        }

        if (await hasNoMatchMessageBeenSent(prisma, settings.guildId)) {
          logger.info(
            `⏭️  Skipping no-match message for guild ${guild.name} - already sent a no-match message`
          );
          continue;
        }

        const nextMatch = await getNextMatchForGuild(prisma, settings);

        const message = "🔔 Pas de match aujourd'hui, prochain match connu :";

        if (nextMatch) {
          const embed = await createMatchEmbed({
            kcTeam: nextMatch.kcTeam,
            kcId: nextMatch.kcId,
            opponent: nextMatch.opponent,
            opponentImage: nextMatch.opponentImage,
            tournamentName: nextMatch.tournamentName,
            leagueName: nextMatch.leagueName,
            leagueImage: nextMatch.leagueImage,
            serieName: nextMatch.serieName,
            numberOfGames: nextMatch.numberOfGames,
            beginAt: nextMatch.beginAt,
          });

          await channel.send({ content: message, embeds: [embed] });
        } else {
          await channel.send(message + " : date inconnue pour le moment");
        }

        await markNoMatchMessageSent(prisma, settings.guildId);

        logger.info(`✅ Sent "no matches" message in guild ${guild.name}`);

        if (i < guildSettings.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
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

async function sendDailyMatchAnnouncementWithReset(
  client: Client,
  prisma: PrismaClient,
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
        const guild = client.guilds.cache.get(settings.guildId);
        if (!guild) {
          logger.warn(`Guild ${settings.guildId} not found`);
          continue;
        }

        const channel = guild.channels.cache.get(
          settings.channelId
        ) as TextChannel;
        if (!channel) {
          logger.warn(`Channel not found in guild ${settings.guildId}`);
          continue;
        }

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

        await clearNoMatchMessageFlag(prisma, settings.guildId);

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

        if (i < guildSettings.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
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

main();
