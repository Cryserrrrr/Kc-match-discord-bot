#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { PandaScoreService } from "../services/pandascore";
import { config } from "dotenv";
import { logger } from "../utils/logger";
import { Client, GatewayIntentBits } from "discord.js";
import {
  sendLastMinuteNotification,
  sendScoreNotification,
  sendRescheduleNotification,
} from "../utils/notificationUtils";

config();

const MAX_RETRIES = 5;
const INITIAL_DELAY = 2000;
const MAX_DELAY = 60000;

let client: Client | null = null;
let isClientReady = false;
let guildSettingsCache: any[] | null = null;
let lastCacheUpdate = 0;
const CACHE_DURATION = 5 * 60 * 1000;

function isDateToday(date: Date): boolean {
  const now = new Date();

  let currentDayStart: Date;
  let currentDayEnd: Date;

  if (now.getHours() < 12) {
    currentDayStart = new Date(now);
    currentDayStart.setDate(currentDayStart.getDate() - 1);
    currentDayStart.setHours(12, 0, 0, 0);

    currentDayEnd = new Date(now);
    currentDayEnd.setHours(12, 0, 0, 0);
  } else {
    currentDayStart = new Date(now);
    currentDayStart.setHours(12, 0, 0, 0);

    currentDayEnd = new Date(currentDayStart);
    currentDayEnd.setDate(currentDayEnd.getDate() + 1);
  }

  return date >= currentDayStart && date < currentDayEnd;
}

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
    const [upcomingMatches, liveMatches, pastMatches] = await withRetry(
      async () => {
        const [upcomingPromise, livePromise, pastPromise] = [
          pandaScoreService.getKarmineCorpMatches(),
          pandaScoreService.getKarmineCorpLiveMatches(),
          pandaScoreService.getKarmineCorpPastMatches(),
        ];

        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error("PandaScore API timeout")), 60000)
        );

        return Promise.race([
          Promise.all([upcomingPromise, livePromise, pastPromise]),
          timeoutPromise,
        ]) as Promise<[any[], any[], any[]]>;
      }
    );

    const allMatches = [...upcomingMatches, ...liveMatches, ...pastMatches];
    logger.info(
      `📊 Total matches found: ${allMatches.length} (${upcomingMatches.length} upcoming, ${liveMatches.length} live, ${pastMatches.length} past)`
    );

    for (const match of allMatches) {
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
                  status: match.status,
                  tournamentId: match.tournament.id.toString(),
                  hasBracket: match.tournament.has_bracket,
                },
              });

              logger.info(
                `✅ New match added to database: ${dbMatch.kcTeam} vs ${dbMatch.opponent} (status: ${dbMatch.status})`
              );

              if (match.status === "live") {
                logger.info(
                  `🚨 Last minute announcement for new live match ${dbMatch.id}: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
                );

                try {
                  const guildSettings = await getGuildSettings();
                  if (guildSettings.length > 0) {
                    const discordClient = await getDiscordClient();
                    await sendLastMinuteNotification(
                      discordClient,
                      dbMatch,
                      guildSettings
                    );
                  }
                } catch (notificationError) {
                  logger.error(
                    `Error sending last minute notification for new match ${dbMatch.id}:`,
                    notificationError
                  );
                }
              }
            } else {
              const { opponentName, opponentImage } =
                pandaScoreService.getOpponentNameAndImage(match);

              if (
                dbMatch.opponent === "Unknown Team" &&
                opponentName !== "Unknown Team"
              ) {
                await prisma.match.update({
                  where: { id: matchId },
                  data: {
                    opponent: opponentName,
                    opponentImage: opponentImage,
                  },
                });

                logger.info(
                  `🔄 Updated opponent name for match ${dbMatch.id}: "Unknown Team" → "${opponentName}"`
                );
              }

              if (
                dbMatch.status === "not_started" &&
                match.rescheduled === true
              ) {
                const newScheduledAt = new Date(match.scheduled_at);
                const currentBeginAt = dbMatch.beginAt;

                if (newScheduledAt.getTime() !== currentBeginAt.getTime()) {
                  await prisma.match.update({
                    where: { id: matchId },
                    data: {
                      beginAt: newScheduledAt,
                    },
                  });

                  logger.info(
                    `🕐 Match ${dbMatch.id} rescheduled: ${dbMatch.kcTeam} vs ${
                      dbMatch.opponent
                    } - New time: ${newScheduledAt.toISOString()}`
                  );

                  const isOriginalDateToday = isDateToday(currentBeginAt);
                  const isRescheduledToAnotherDay =
                    !isDateToday(newScheduledAt);

                  if (isOriginalDateToday && isRescheduledToAnotherDay) {
                    try {
                      const guildSettings = await getGuildSettings();
                      if (guildSettings.length > 0) {
                        const discordClient = await getDiscordClient();
                        await sendRescheduleNotification(
                          discordClient,
                          { ...dbMatch, beginAt: newScheduledAt },
                          currentBeginAt,
                          guildSettings
                        );
                      }
                    } catch (rescheduleNotificationError) {
                      logger.error(
                        `Error sending reschedule notification for match ${dbMatch.id}:`,
                        rescheduleNotificationError
                      );
                    }
                  }
                }
              }
            }
          } catch (matchError) {
            logger.error(`❌ Error processing match ${match.id}:`, matchError);
            throw matchError;
          }
        },
        3,
        1000
      );
    }

    await updateExistingMatchesStatus(
      prisma,
      pandaScoreService,
      liveMatches,
      pastMatches
    );
  } catch (error) {
    logger.error("❌ Error checking matches:", error);
    throw error;
  }
}

async function updateExistingMatchesStatus(
  prisma: PrismaClient,
  pandaScoreService: PandaScoreService,
  liveMatches: any[],
  pastMatches: any[]
) {
  try {
    const activeMatches = await prisma.match.findMany({
      where: {
        status: {
          in: ["not_started", "live", "finished"],
        },
      },
    });

    if (activeMatches.length === 0) {
      logger.info("📭 No active matches found in database");
      return;
    }

    logger.info(
      `📊 Found ${activeMatches.length} active matches in database to update`
    );

    const liveMatchIds = new Set(liveMatches.map((m) => m.id.toString()));
    const pastMatchIds = new Set(pastMatches.map((m) => m.id.toString()));

    for (const dbMatch of activeMatches) {
      try {
        let status = dbMatch.status;
        let score = dbMatch.score;
        let shouldSendScoreNotification = false;

        if (liveMatchIds.has(dbMatch.id)) {
          status = "live";

          if (dbMatch.status === "not_started") {
            logger.info(
              `🚨 Last minute announcement for match ${dbMatch.id}: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
            );

            try {
              const guildSettings = await getGuildSettings();
              if (guildSettings.length > 0) {
                const discordClient = await getDiscordClient();
                await sendLastMinuteNotification(
                  discordClient,
                  dbMatch,
                  guildSettings
                );
              }
            } catch (notificationError) {
              logger.error(
                `Error sending last minute notification for match ${dbMatch.id}:`,
                notificationError
              );
            }
          }
        } else if (pastMatchIds.has(dbMatch.id)) {
          const pastMatch = pastMatches.find(
            (m) => m.id.toString() === dbMatch.id
          );
          if (pastMatch) {
            if (dbMatch.status === "live") {
              status = "finished";
              shouldSendScoreNotification = true;
            } else {
              status = "announced";
            }

            const matchScore = pandaScoreService.getMatchScore(pastMatch);
            if (matchScore) {
              score = matchScore;
              logger.info(
                `🏆 Match ${dbMatch.id} finished with score: ${matchScore}`
              );
            }
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

          if (shouldSendScoreNotification && score) {
            try {
              const guildSettings = await getGuildSettings();
              if (guildSettings.length > 0) {
                const discordClient = await getDiscordClient();
                await sendScoreNotification(
                  discordClient,
                  { ...dbMatch, score },
                  guildSettings
                );
              }
            } catch (scoreNotificationError) {
              logger.error(
                `Error sending score notification for match ${dbMatch.id}:`,
                scoreNotificationError
              );
            }
          }
        }
      } catch (matchError) {
        logger.error(`❌ Error updating match ${dbMatch.id}:`, matchError);
      }
    }
  } catch (error) {
    logger.error("❌ Error updating existing matches status:", error);
  }
}

process.on("SIGINT", cleanup);
process.on("SIGTERM", cleanup);

main();
