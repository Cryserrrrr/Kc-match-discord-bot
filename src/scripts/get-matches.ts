#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits } from "discord.js";
import { PandaScoreService } from "../services/pandascore";
import { config } from "dotenv";

// Load environment variables
config();

async function main() {
  console.log("🔍 Starting external match check...");

  try {
    // Initialize Prisma
    const prisma = new PrismaClient();

    // Create Discord client
    const client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
    });

    // Login to Discord
    await client.login(process.env.DISCORD_TOKEN);

    // Wait for client to be ready
    await new Promise<void>((resolve) => {
      client.once("ready", () => {
        console.log(`✅ Bot logged in as ${client.user?.tag}`);
        resolve();
      });
    });

    console.log("🔍 Checking for new matches...");
    await checkAndAnnounceMatches(client, prisma);

    console.log("✅ Match check completed successfully");

    // Cleanup
    await prisma.$disconnect();
    await client.destroy();

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during match check:", error);
    process.exit(1);
  }
}

async function checkAndAnnounceMatches(client: Client, prisma: PrismaClient) {
  const pandaScoreService = new PandaScoreService();
  const today = new Date().toISOString().split("T")[0];

  try {
    // Fetch matches from PandaScore
    const matches = await pandaScoreService.getKarmineCorpMatches(today);

    for (const match of matches) {
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
            announced: false,
          },
        });

        console.log(
          `New match added to database: ${dbMatch.kcTeam} vs ${dbMatch.opponent}`
        );
      }
    }
  } catch (error) {
    console.error("Error checking matches:", error);
  }
}

// Run the script
main();
