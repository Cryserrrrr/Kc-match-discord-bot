import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { createMatchEmbed } from "../utils/embedBuilder";
import { logger } from "../utils/logger";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const prisma = new PrismaClient();

// Initialize Discord client
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
});

async function checkUpcomingMatches() {
  try {
    logger.info("Starting check for upcoming matches...");

    // Get current time and time in 1 hour
    const now = new Date();
    const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000);

    // Find matches that are scheduled within the next hour and haven't been announced
    const upcomingMatches = await prisma.match.findMany({
      where: {
        beginAt: {
          gte: now,
          lte: oneHourFromNow,
        },
        announced: false,
      },
      orderBy: {
        beginAt: "asc",
      },
    });

    logger.info(
      `Found ${upcomingMatches.length} upcoming matches within the next hour`
    );

    if (upcomingMatches.length === 0) {
      logger.info("No upcoming matches to announce");
      return;
    }

    // Get all guild settings
    const guildSettings = await prisma.guildSettings.findMany();

    if (guildSettings.length === 0) {
      logger.warn("No guild settings found. No channels to announce to.");
      return;
    }

    // Login to Discord
    await client.login(process.env.DISCORD_TOKEN);

    // Wait for client to be ready
    await new Promise<void>((resolve) => {
      client.once("ready", () => {
        logger.info(`Logged in as ${client.user?.tag}`);
        resolve();
      });
    });

    // Announce each match
    for (const match of upcomingMatches) {
      try {
        // Create embed for the match
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

        // Send announcement to all configured channels
        for (const setting of guildSettings) {
          try {
            const guild = client.guilds.cache.get(setting.guildId);
            if (!guild) {
              logger.warn(`Guild ${setting.guildId} not found`);
              continue;
            }

            const channel = guild.channels.cache.get(
              setting.channelId
            ) as TextChannel;
            if (!channel) {
              logger.warn(
                `Channel ${setting.channelId} not found in guild ${setting.guildId}`
              );
              continue;
            }

            // Check if this match should be announced based on team filter
            if (
              (setting as any).filteredTeams &&
              (setting as any).filteredTeams.length > 0
            ) {
              if (!(setting as any).filteredTeams.includes(match.kcId)) {
                logger.info(
                  `Skipping match ${match.id} for guild ${setting.guildId} - team ${match.kcId} not in filter`
                );
                return;
              }
            }

            // Replace placeholders in custom message if it exists
            let message = `🚨 **Match de dernière minute !** 🚨\n${setting.customMessage}`;

            // Send the announcement
            await channel.send({
              content: message,
              embeds: [embed],
            });

            logger.info(
              `Announced match ${match.id} to channel ${setting.channelId} in guild ${setting.guildId}`
            );
          } catch (error) {
            logger.error(
              `Error announcing match to guild ${setting.guildId}:`,
              error
            );
          }
        }

        // Mark the match as announced
        await prisma.match.update({
          where: { id: match.id },
          data: { announced: true },
        });

        logger.info(`Marked match ${match.id} as announced`);
      } catch (error) {
        logger.error(`Error processing match ${match.id}:`, error);
      }
    }

    logger.info("Finished checking upcoming matches");
  } catch (error) {
    logger.error("Error in checkUpcomingMatches:", error);
  } finally {
    await prisma.$disconnect();
    await client.destroy();
  }
}

// Run the script if called directly
if (require.main === module) {
  checkUpcomingMatches()
    .then(() => {
      logger.info("Script completed successfully");
      process.exit(0);
    })
    .catch((error) => {
      logger.error("Script failed:", error);
      process.exit(1);
    });
}

export { checkUpcomingMatches };
