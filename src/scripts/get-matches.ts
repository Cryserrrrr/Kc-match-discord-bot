#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { PandaScoreService } from "../services/pandascore";
import { config } from "dotenv";

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
      console.log(`🔄 Attempt ${attempt}/${maxRetries}`);
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
  console.log("🔍 Starting external match check...");

  let prisma: PrismaClient | null = null;

  try {
    await withRetry(async () => {
      prisma = new PrismaClient();
      await prisma.$queryRaw`SELECT 1`;
      console.log("✅ Database connection established");
    });

    console.log("🔍 Checking for new matches...");
    if (!prisma) {
      throw new Error("Failed to initialize Prisma client");
    }
    await withRetry(async () => checkAndSaveMatches(prisma!));

    console.log("✅ Match check completed successfully");
  } catch (error) {
    console.error(
      "💥 CRITICAL ERROR - Script failed after all retries:",
      error
    );
    process.exit(1);
  } finally {
    try {
      if (prisma) {
        await (prisma as PrismaClient).$disconnect();
      }
    } catch (cleanupError) {
      console.error("❌ Error during cleanup:", cleanupError);
    }

    process.exit(0);
  }
}

async function checkAndSaveMatches(prisma: PrismaClient) {
  const pandaScoreService = new PandaScoreService();
  const today = new Date().toISOString().split("T")[0];

  try {
    console.log(`📅 Fetching matches for date: ${today}`);

    // Fetch matches from PandaScore with retry
    const matches = await withRetry(async () => {
      const matchesPromise = pandaScoreService.getKarmineCorpMatches(today);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("PandaScore API timeout")), 60000)
      );

      return (await Promise.race([matchesPromise, timeoutPromise])) as any[];
    });

    console.log(`📊 Found ${matches.length} matches from PandaScore`);

    // Process matches with individual retry for each
    for (const match of matches) {
      await withRetry(
        async () => {
          try {
            const matchId = match.id.toString();

            // Check if match already exists in database
            let dbMatch = await prisma.match.findUnique({
              where: { id: matchId },
            });

            if (!dbMatch) {
              const { opponentName, opponentImage } =
                pandaScoreService.getOpponentNameAndImage(match);
              const { kcTeam, kcId } = pandaScoreService.getKcTeamAndId(match);

              // Create new match in database
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
                },
              });

              console.log(
                `✅ New match added to database: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
              );
            } else {
              console.log(
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
  } catch (error) {
    console.error("❌ Error checking matches:", error);
    throw error;
  }
}

// Run the script
main();
