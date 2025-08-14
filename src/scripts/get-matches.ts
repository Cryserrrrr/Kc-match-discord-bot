#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { PandaScoreService } from "../services/pandascore";
import { config } from "dotenv";
import { logger } from "../utils/logger";
import {
  Client,
  GatewayIntentBits,
  TextChannel,
  ChannelType,
} from "discord.js";
import { createMatchEmbed } from "../utils/embedBuilder";
import { formatRoleMentions } from "../utils/roleMentions";

config();

const MAX_RETRIES = 5;
const INITIAL_DELAY = 2000;
const MAX_DELAY = 60000;

let client: Client | null = null;
let isClientReady = false;
let guildSettingsCache: any[] | null = null;
let lastCacheUpdate = 0;
const CACHE_DURATION = 5 * 60 * 1000;

async function getDiscordClient(): Promise<Client> {
  if (!client) {
    client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });
  }

  if (!isClientReady) {
    await withRetry(async () => {
      try {
        await client!.login(process.env.DISCORD_TOKEN);
        isClientReady = true;
        logger.info(`Logged in as ${client!.user?.tag}`);
      } catch (error) {
        logger.error("Failed to login to Discord:", error);
        throw error;
      }
    });
  }

  return client;
}

async function getGuildSettings(): Promise<any[]> {
  const now = Date.now();

  if (guildSettingsCache && now - lastCacheUpdate < CACHE_DURATION) {
    return guildSettingsCache;
  }

  const prismaClient = new PrismaClient();
  guildSettingsCache = await prismaClient.guildSettings.findMany();
  await prismaClient.$disconnect();

  lastCacheUpdate = now;

  return guildSettingsCache;
}

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
      logger.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        logger.error(
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

async function cleanup() {
  if (client && isClientReady) {
    try {
      await client.destroy();
      client = null;
      isClientReady = false;
    } catch (error) {
      logger.warn("Error destroying Discord client:", error);
    }
  }
  guildSettingsCache = null;
}

async function main() {
  let prisma: PrismaClient | null = null;

  try {
    await withRetry(async () => {
      prisma = new PrismaClient();
      await prisma.$queryRaw`SELECT 1`;
    });

    if (!prisma) {
      throw new Error("Failed to initialize Prisma client");
    }
    await withRetry(async () => checkAndSaveMatches(prisma!));
  } catch (error) {
    logger.error("💥 CRITICAL ERROR - Script failed after all retries:", error);
    process.exit(1);
  } finally {
    try {
      if (prisma) {
        await (prisma as PrismaClient).$disconnect();
      }
    } catch (cleanupError) {
      logger.error("❌ Error during cleanup:", cleanupError);
    }

    await cleanup();
    process.exit(0);
  }
}

async function checkAndSaveMatches(prisma: PrismaClient) {
  const pandaScoreService = new PandaScoreService();

  try {
    const matches = await withRetry(async () => {
      const matchesPromise = pandaScoreService.getKarmineCorpMatches();
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PandaScore API timeout")), 60000)
      );

      return (await Promise.race([matchesPromise, timeoutPromise])) as any[];
    });

    for (const match of matches) {
      await withRetry(
        async () => {
          try {
            const matchId = match.id.toString();

            let dbMatch = await prisma.match.findUnique({
              where: { id: matchId },
            });

            if (!dbMatch) {
              const { opponentName, opponentImage } =
                pandaScoreService.getOpponentNameAndImage(match);
              const { kcTeam, kcId } = pandaScoreService.getKcTeamAndId(match);

              dbMatch = await prisma.match.create({
                data: {
                  id: matchId,
                  kcTeam: kcTeam,
                  kcId: kcId.toString(),
                  opponent: opponentName,
                  opponentImage: opponentImage,
                  leagueName: match.league.name,
                  leagueImage: match.league.image_url,
                  serieName: match.serie.full_name,
                  tournamentName: match.tournament.name,
                  numberOfGames: match.number_of_games,
                  beginAt: new Date(match.scheduled_at),
                  status: "scheduled",
                  tournamentId: match.tournament.id.toString(),
                  hasBracket: match.tournament.has_bracket,
                },
              });

              logger.info(
                `✅ New match added to database: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
              );
            }
          } catch (matchError) {
            logger.error(`❌ Error processing match ${match.id}:`, matchError);
            throw matchError; // Re-throw to trigger retry
          }
        },
        3,
        1000
      );
    }

    await checkLiveMatchesAndUpdateScores(prisma, pandaScoreService);
  } catch (error) {
    logger.error("❌ Error checking matches:", error);
    throw error;
  }
}

async function sendLastMinuteNotification(match: any, guildSettings: any[]) {
  try {
    const discordClient = await getDiscordClient();

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

    const channelPromises = guildSettings.map(async (setting) => {
      try {
        if (!setting.enablePreMatchNotifications) {
          return;
        }

        if (setting.filteredTeams && setting.filteredTeams.length > 0) {
          if (!setting.filteredTeams.includes(match.kcId)) {
            return;
          }
        }

        const guild = discordClient.guilds.cache.get(setting.guildId);
        if (!guild) {
          logger.warn(`Guild ${setting.guildId} not found`);
          return;
        }

        try {
          await guild.fetch();
        } catch (error) {
          logger.warn(`Failed to fetch guild ${setting.guildId}:`, error);
        }

        const channel = guild.channels.cache.get(
          setting.channelId
        ) as TextChannel;
        if (!channel) {
          return;
        }

        // Create ping message with selected roles
        const pingRoles = (setting as any).pingRoles || [];
        const roleMentions = formatRoleMentions(pingRoles);
        const message =
          pingRoles.length > 0
            ? `${roleMentions}\n🚨 **MATCH EN COURS !** 🚨`
            : `🚨 **MATCH EN COURS !** 🚨`;

        await Promise.race([
          channel.send({
            content: message,
            embeds: [embed],
          }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("Send timeout")), 10000)
          ),
        ]);

        logger.info(
          `Sent last minute notification for match ${match.id} to guild ${setting.guildId}`
        );
      } catch (error) {
        logger.error(
          `Error sending last minute notification to guild ${setting.guildId}:`,
          error
        );
      }
    });

    await Promise.allSettled(channelPromises);
  } catch (error) {
    logger.error(
      `Error sending last minute notification for match ${match.id}:`,
      error
    );
  }
}

async function checkLiveMatchesAndUpdateScores(
  prisma: PrismaClient,
  pandaScoreService: PandaScoreService
) {
  try {
    const activeMatches = await prisma.match.findMany({
      where: {
        status: {
          in: ["scheduled", "pre-announced", "live"],
        },
        beginAt: {
          lte: new Date(),
        },
      },
    });

    if (activeMatches.length === 0) {
      logger.info("📭 No active matches found");
      return;
    }

    logger.info(`📊 Found ${activeMatches.length} active matches to check`);

    for (const dbMatch of activeMatches) {
      await withRetry(
        async () => {
          try {
            const currentMatch = await pandaScoreService.getMatchById(
              parseInt(dbMatch.id)
            );

            if (!currentMatch) {
              return;
            }

            let status = dbMatch.status;
            let score = dbMatch.score;

            if (currentMatch.status === "running") {
              status = "live";

              if (dbMatch.status === "scheduled") {
                logger.info(
                  `🚨 Last minute announcement for match ${dbMatch.id}: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
                );

                try {
                  const guildSettings = await getGuildSettings();
                  if (guildSettings.length > 0) {
                    await sendLastMinuteNotification(dbMatch, guildSettings);
                  }
                } catch (notificationError) {
                  logger.error(
                    `Error sending last minute notification for match ${dbMatch.id}:`,
                    notificationError
                  );
                }
              }
            } else if (currentMatch.status === "finished") {
              status = "finished";
              const matchScore = pandaScoreService.getMatchScore(currentMatch);
              if (matchScore) {
                score = matchScore;
                logger.info(
                  `🏆 Match ${dbMatch.id} finished with score: ${matchScore}`
                );
              }
            }

            if (status !== dbMatch.status || score !== dbMatch.score) {
              await prisma.match.update({
                where: { id: dbMatch.id },
                data: {
                  status: status,
                  score: score,
                },
              });

              logger.info(
                `✅ Updated match ${dbMatch.id}: status=${status}, score=${
                  score || "N/A"
                }`
              );
            }
          } catch (matchError) {
            logger.error(`❌ Error checking match ${dbMatch.id}:`, matchError);
            // Don't throw here to avoid stopping the entire process
          }
        },
        2,
        1000
      );
    }
  } catch (error) {
    logger.error("❌ Error checking live matches:", error);
    // Don't throw here to avoid stopping the main match fetching process
  }
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

// Run the script
main();
