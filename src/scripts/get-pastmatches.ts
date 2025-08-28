import { PrismaClient } from "@prisma/client";
import { PandaScoreService } from "../services/pandascore";
import { logger } from "../utils/logger";

const prisma = new PrismaClient();
const pandaScoreService = new PandaScoreService();

interface PandaScoreMatch {
  id: number;
  name: string;
  scheduled_at: string;
  end_at: string | null;
  game: {
    name: string;
  };
  opponents: Array<{
    opponent: {
      id: number;
      name: string;
      acronym: string;
      image_url: string;
    };
  }>;
  league: {
    name: string;
    image_url: string;
  };
  serie: {
    full_name: string;
  };
  tournament: {
    name: string;
    has_bracket: boolean;
    id: number;
  };
  number_of_games: number;
  tournament_id: number;
  status?: string;
  results?: Array<{
    score: number;
    team_id: number;
  }>;
}

async function getAllPastMatches(): Promise<PandaScoreMatch[]> {
  const kcTeamIds = [
    "134078",
    "128268",
    "136080",
    "130922",
    "132777",
    "136165",
    "129570",
  ];

  const allMatches: PandaScoreMatch[] = [];
  let page = 1;
  let hasMorePages = true;

  logger.info("Starting to fetch all past Karmine Corp matches...");

  while (hasMorePages) {
    try {
      logger.info(`Fetching page ${page}...`);

      const response = await pandaScoreService["makeRequest"]("/matches/past", {
        "filter[opponent_id]": kcTeamIds.join(","),
        sort: "-begin_at",
        per_page: 100,
        page: page,
      });

      if (!response || response.length === 0) {
        logger.info(`No more matches found on page ${page}`);
        hasMorePages = false;
        break;
      }

      const karmineMatches = response.filter((match: PandaScoreMatch) =>
        match.opponents.some((opponent) =>
          kcTeamIds.includes(opponent.opponent.id.toString())
        )
      );

      allMatches.push(...karmineMatches);
      logger.info(
        `Found ${karmineMatches.length} Karmine Corp matches on page ${page}`
      );

      if (response.length < 100) {
        hasMorePages = false;
        logger.info(
          `Reached last page (${page}) with ${response.length} matches`
        );
      }

      page++;

      await new Promise((resolve) => setTimeout(resolve, 100));
    } catch (error) {
      logger.error(`Error fetching page ${page}:`, error);
      hasMorePages = false;
      break;
    }
  }

  logger.info(`Total past matches found: ${allMatches.length}`);
  return allMatches;
}

async function saveMatchesToDatabase(
  matches: PandaScoreMatch[]
): Promise<void> {
  logger.info(`Saving ${matches.length} matches to database...`);

  let savedCount = 0;
  let skippedCount = 0;
  let errorCount = 0;

  for (const match of matches) {
    try {
      const existingMatch = await prisma.match.findUnique({
        where: { id: match.id.toString() },
      });

      if (existingMatch) {
        skippedCount++;
        continue;
      }

      const { kcTeam, kcId } = pandaScoreService.getKcTeamAndId(match);
      const { opponentName, opponentImage } =
        pandaScoreService.getOpponentNameAndImage(match);
      const score = pandaScoreService.getMatchScore(match);

      let status = "announced";
      if (match.status !== "finished" && match.status !== undefined) {
        status = match.status;
      }

      await prisma.match.create({
        data: {
          id: match.id.toString(),
          kcTeam: kcTeam,
          kcId: kcId.toString(),
          opponent: opponentName,
          opponentImage: opponentImage,
          tournamentName: match.tournament.name,
          tournamentId: match.tournament_id.toString(),
          leagueName: match.league.name,
          serieName: match.serie.full_name,
          beginAt: new Date(match.scheduled_at),
          status: status,
          score: score,
          numberOfGames: match.number_of_games,
          hasBracket: match.tournament.has_bracket,
        },
      });

      savedCount++;

      if (savedCount % 50 === 0) {
        logger.info(`Progress: ${savedCount}/${matches.length} matches saved`);
      }
    } catch (error) {
      logger.error(`Error saving match ${match.id}:`, error);
      errorCount++;
    }
  }

  logger.info(`Database update completed:`);
  logger.info(`- Saved: ${savedCount} matches`);
  logger.info(`- Skipped (already exists): ${skippedCount} matches`);
  logger.info(`- Errors: ${errorCount} matches`);
}

async function main() {
  try {
    logger.info("Starting get-pastmatches script...");

    const matches = await getAllPastMatches();

    if (matches.length === 0) {
      logger.info("No past matches found");
      return;
    }

    await saveMatchesToDatabase(matches);

    logger.info("get-pastmatches script completed successfully");
  } catch (error) {
    logger.error("Error in get-pastmatches script:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main();
}

export { main as getPastMatches };
