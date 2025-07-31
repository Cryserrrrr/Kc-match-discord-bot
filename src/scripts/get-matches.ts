#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { PandaScoreService } from "../services/pandascore";
import { config } from "dotenv";

// Load environment variables
config();

async function main() {
  console.log("🔍 Starting external match check...");

  let prisma: PrismaClient | null = null;

  try {
    // Initialize Prisma
    prisma = new PrismaClient();

    console.log("🔍 Checking for new matches...");
    await checkAndSaveMatches(prisma);

    console.log("✅ Match check completed successfully");
  } catch (error) {
    console.error("❌ Error during match check:", error);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      if (prisma) {
        await prisma.$disconnect();
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

    // Fetch matches from PandaScore with timeout
    const matchesPromise = pandaScoreService.getKarmineCorpMatches(today);
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error("PandaScore API timeout")), 60000)
    );

    const matches = (await Promise.race([
      matchesPromise,
      timeoutPromise,
    ])) as any[];

    console.log(`📊 Found ${matches.length} matches from PandaScore`);

    for (const match of matches) {
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
        // Continue with next match instead of failing completely
      }
    }
  } catch (error) {
    console.error("❌ Error checking matches:", error);
    throw error;
  }
}

// Run the script
main();
