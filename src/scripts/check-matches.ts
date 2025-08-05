#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { config } from "dotenv";
import { createMatchEmbed } from "../utils/embedBuilder";
import { logger } from "../utils/logger";
import { formatRoleMentions } from "../utils/roleMentions";

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

      console.log(`⏳ Retrying in ${delay}ms...`);
      await new Promise((resolve) => setTimeout(resolve, delay));

      delay = Math.min(delay * 2, MAX_DELAY);
    }
  }

  throw lastError!;
}

async function main() {
  console.log("🔍 Starting 24h match check from database...");

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
          console.log(`✅ Bot logged in as ${client!.user?.tag}`);
          resolve();
        });
      });
    });

    // Get matches for next 24 hours from database with retry
    const matches = await withRetry(async () => {
      if (!prisma) throw new Error("Prisma client not initialized");
      return await getMatchesNext24Hours(prisma);
    });

    if (matches.length === 0) {
      logger.info("📭 No matches found for the next 24 hours in database");
      await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        await announceNoMatches(client, prisma);
      });
    } else {
      logger.info(
        `📅 Found ${matches.length} matches for the next 24 hours in database`
      );

      // Announce all matches with retry
      const hasAnnouncements = await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        return await announceAllMatches(client, prisma, matches);
      });

      // Only send "no matches" message if no guild received any announcements
      if (!hasAnnouncements) {
        logger.info(
          "📭 No guilds received match announcements - sending no matches message"
        );
        await withRetry(async () => {
          if (!client || !prisma) throw new Error("Clients not initialized");
          await announceNoMatches(client, prisma);
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
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const matches = await prisma.match.findMany({
      where: {
        beginAt: {
          gte: now,
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

async function announceNoMatches(client: Client, prisma: PrismaClient) {
  try {
    const guildSettings = await prisma.guildSettings.findMany();

    if (guildSettings.length === 0) {
      logger.info(
        "⚠️  No guild settings found - no channels configured for announcements"
      );
      return;
    }

    for (const settings of guildSettings) {
      await withRetry(
        async () => {
          try {
            const guild = await client.guilds.fetch(settings.guildId);
            const channel = await guild.channels.fetch(settings.channelId);

            if (channel instanceof TextChannel) {
              await channel.send("🔔 Pas de match aujourd'hui");
              logger.info(
                `✅ Sent "no matches" message in guild ${guild.name}`
              );
            }
          } catch (error) {
            logger.error(
              `❌ Failed to send "no matches" message in guild ${settings.guildId}:`,
              error
            );
            throw error; // Re-throw to trigger retry
          }
        },
        3,
        1000
      );
    }
  } catch (error) {
    logger.error("❌ Error sending no matches message:", error);
    throw error;
  }
}

async function announceAllMatches(
  client: Client,
  prisma: PrismaClient,
  matches: any[]
): Promise<boolean> {
  try {
    const guildSettings = await prisma.guildSettings.findMany();

    if (guildSettings.length === 0) {
      logger.info(
        "⚠️  No guild settings found - no channels configured for announcements"
      );
      return false;
    }

    let hasAnnouncements = false;

    for (const settings of guildSettings) {
      await withRetry(
        async () => {
          try {
            const guild = await client.guilds.fetch(settings.guildId);
            const channel = await guild.channels.fetch(settings.channelId);

            if (channel instanceof TextChannel) {
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
                return;
              }

              // Create ping message with selected roles
              const pingRoles = (settings as any).pingRoles || [];
              const roleMentions = formatRoleMentions(pingRoles);
              const pingMessage =
                pingRoles.length > 0
                  ? `${roleMentions} Match du jour !`
                  : "Match du jour !";

              await channel.send(pingMessage);

              for (const match of filteredMatches) {
                await withRetry(
                  async () => {
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

                      await new Promise((resolve) => setTimeout(resolve, 1000));
                    } catch (matchError) {
                      logger.error(
                        `❌ Error sending match ${match.id}:`,
                        matchError
                      );
                      throw matchError; // Re-throw to trigger retry
                    }
                  },
                  2,
                  500
                );
              }

              logger.info(
                `✅ Successfully announced ${filteredMatches.length} matches in guild ${guild.name}`
              );
              hasAnnouncements = true;
            }
          } catch (error) {
            logger.error(
              `❌ Failed to announce matches in guild ${settings.guildId}:`,
              error
            );
            throw error; // Re-throw to trigger retry
          }
        },
        3,
        1000
      );
    }

    return hasAnnouncements;
  } catch (error) {
    logger.error("❌ Error announcing matches:", error);
    throw error;
  }
}

main();
