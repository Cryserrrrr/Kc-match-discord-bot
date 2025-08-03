#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { PandaScoreService } from "../services/pandascore";
import { config } from "dotenv";
import { logger } from "../utils/logger";

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

    process.exit(0);
  }
}

async function checkAndSaveMatches(prisma: PrismaClient) {
  const pandaScoreService = new PandaScoreService();
  const today = new Date().toISOString().split("T")[0];

  try {
    const matches = await withRetry(async () => {
      const matchesPromise = pandaScoreService.getKarmineCorpMatches(today);
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
                },
              });

              logger.info(
                `✅ New match added to database: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
              );
            } else {
              logger.info(
                `⏭️  Match already exists: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
              );
            }
          } catch (matchError) {
            console.error(`❌ Error processing match ${match.id}:`, matchError);
            throw matchError; // Re-throw to trigger retry
          }
        },
        3,
        1000
      ); // 3 retries for individual matches, 1 second delay
    }

    // Check for live matches and update scores
    await checkLiveMatchesAndUpdateScores(prisma, pandaScoreService);
  } catch (error) {
    console.error("❌ Error checking matches:", error);
    throw error;
  }
}

async function checkLiveMatchesAndUpdateScores(
  prisma: PrismaClient,
  pandaScoreService: PandaScoreService
) {
  try {
    // Get matches that are scheduled or live
    const activeMatches = await prisma.match.findMany({
      where: {
        status: {
          in: ["scheduled", "live"],
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

// Run the script
main();
