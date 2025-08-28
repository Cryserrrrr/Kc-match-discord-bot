import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { logger } from "../utils/logger";
import { PandaScoreService } from "../services/pandascore";

config();

const prisma = new PrismaClient();
const pandaScoreService = new PandaScoreService();

async function updateMatches() {
  try {
    logger.info("Starting matches update...");

    const matches = await prisma.match.findMany({
      orderBy: { beginAt: "desc" },
    });

    logger.info(`Found ${matches.length} matches to update`);

    let updatedCount = 0;
    let errorCount = 0;

    for (const match of matches) {
      try {
        logger.info(
          `Updating match ${match.id} (${match.kcTeam} vs ${match.opponent})`
        );

        const updatedMatchData = await pandaScoreService.getMatch(match.id);

        if (!updatedMatchData) {
          logger.warn(`No data found for match ${match.id}`);
          continue;
        }

        const updateData: any = {
          kcTeam: updatedMatchData.kcTeam || match.kcTeam,
          opponent: updatedMatchData.opponent || match.opponent,
          opponentImage: updatedMatchData.opponentImage || match.opponentImage,
          leagueName: updatedMatchData.leagueName || match.leagueName,
          leagueImage: updatedMatchData.leagueImage || match.leagueImage,
          serieName: updatedMatchData.serieName || match.serieName,
          tournamentName:
            updatedMatchData.tournamentName || match.tournamentName,
          tournamentId: updatedMatchData.tournamentId || match.tournamentId,
          hasBracket: updatedMatchData.hasBracket ?? match.hasBracket,
          numberOfGames: updatedMatchData.numberOfGames || match.numberOfGames,
          beginAt: updatedMatchData.beginAt || match.beginAt,
          status: updatedMatchData.status || match.status,
          score: updatedMatchData.score || match.score,
        };

        await prisma.match.update({
          where: { id: match.id },
          data: updateData,
        });

        updatedCount++;
        logger.info(`Match ${match.id} updated successfully`);

        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        errorCount++;
        logger.error(`Error updating match ${match.id}:`, error);
      }
    }

    logger.info(
      `Update completed. ${updatedCount} matches updated, ${errorCount} errors`
    );
  } catch (error) {
    logger.error("Error during matches update:", error);
  } finally {
    await prisma.$disconnect();
  }
}

updateMatches()
  .then(() => {
    logger.info("Update script completed");
    process.exit(0);
  })
  .catch((error) => {
    logger.error("Fatal error:", error);
    process.exit(1);
  });
