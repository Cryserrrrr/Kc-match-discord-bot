#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { config } from "dotenv";
import { createMatchEmbed } from "../utils/embedBuilder";

// Load environment variables
config();

// Retry configuration
const MAX_RETRIES = 5;
const INITIAL_DELAY = 2000; // 2 seconds
const MAX_DELAY = 60000; // 60 seconds

/**
 * Retry function with exponential backoff
 */
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

      // Exponential backoff with max delay
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
    // Initialize Prisma with retry
    await withRetry(async () => {
      prisma = new PrismaClient();
      // Test connection
      await prisma.$queryRaw`SELECT 1`;
      console.log("✅ Database connection established");
    });

    // Create Discord client with retry
    await withRetry(async () => {
      client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      });

      // Login to Discord with timeout
      const loginPromise = client.login(process.env.DISCORD_TOKEN);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Discord login timeout")), 30000)
      );

      await Promise.race([loginPromise, timeoutPromise]);

      // Wait for client to be ready with timeout
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

    console.log(
      "🔍 Checking for matches in the next 24 hours from database..."
    );

    // Get matches for next 24 hours from database with retry
    const matches = await withRetry(async () => {
      if (!prisma) throw new Error("Prisma client not initialized");
      return await getMatchesNext24Hours(prisma);
    });

    if (matches.length === 0) {
      console.log("📭 No matches found for the next 24 hours in database");
      // Send "no matches" message to all configured channels with retry
      await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        await announceNoMatches(client, prisma);
      });
    } else {
      console.log(
        `📅 Found ${matches.length} matches for the next 24 hours in database`
      );

      // Announce all matches with retry
      await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        await announceAllMatches(client, prisma, matches);
      });
    }

    console.log("✅ 24h match check completed successfully");
  } catch (error) {
    console.error(
      "💥 CRITICAL ERROR - Script failed after all retries:",
      error
    );
    process.exit(1);
  } finally {
    // Cleanup
    try {
      if (prisma) {
        await (prisma as PrismaClient).$disconnect();
      }
      if (client) {
        await (client as Client).destroy();
      }
    } catch (cleanupError) {
      console.error("❌ Error during cleanup:", cleanupError);
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

    console.log(
      `📊 Found ${matches.length} matches in database for the next 24 hours`
    );

    // Log each match found
    matches.forEach((match, index) => {
      console.log(
        `${index + 1}. ${match.kcTeam} vs ${match.opponent} - ${new Date(
          match.beginAt
        ).toLocaleString("fr-FR")}`
      );
    });

    return matches;
  } catch (error) {
    console.error("❌ Error fetching matches from database:", error);
    throw error;
  }
}

async function announceNoMatches(client: Client, prisma: PrismaClient) {
  try {
    const guildSettings = await prisma.guildSettings.findMany();

    if (guildSettings.length === 0) {
      console.log(
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
              console.log(
                `✅ Sent "no matches" message in guild ${guild.name}`
              );
            }
          } catch (error) {
            console.error(
              `❌ Failed to send "no matches" message in guild ${settings.guildId}:`,
              error
            );
            throw error; // Re-throw to trigger retry
          }
        },
        3,
        1000
      ); // 3 retries for individual guilds, 1 second delay
    }
  } catch (error) {
    console.error("❌ Error sending no matches message:", error);
    throw error;
  }
}

async function announceAllMatches(
  client: Client,
  prisma: PrismaClient,
  matches: any[]
) {
  try {
    const guildSettings = await prisma.guildSettings.findMany();

    if (guildSettings.length === 0) {
      console.log(
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
              // Filter matches based on guild settings
              let filteredMatches = matches;

              // If filteredTeams is not empty, only show matches for those teams
              if (
                (settings as any).filteredTeams &&
                (settings as any).filteredTeams.length > 0
              ) {
                filteredMatches = matches.filter((match) =>
                  (settings as any).filteredTeams.includes(match.kcId)
                );
              }

              // If no matches after filtering, skip this guild
              if (filteredMatches.length === 0) {
                console.log(
                  `⏭️  No matches to announce for guild ${guild.name} (filtered)`
                );
                await announceNoMatches(client, prisma);
                return;
              }

              // Send the custom message first
              await channel.send(settings.customMessage);

              // Send each match as an embed
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

                      // Small delay between messages to avoid rate limiting
                      await new Promise((resolve) => setTimeout(resolve, 1000));
                    } catch (matchError) {
                      console.error(
                        `❌ Error sending match ${match.id}:`,
                        matchError
                      );
                      throw matchError; // Re-throw to trigger retry
                    }
                  },
                  2,
                  500
                ); // 2 retries for individual matches, 500ms delay
              }

              console.log(
                `✅ Successfully announced ${filteredMatches.length} matches in guild ${guild.name}`
              );
            }
          } catch (error) {
            console.error(
              `❌ Failed to announce matches in guild ${settings.guildId}:`,
              error
            );
            throw error; // Re-throw to trigger retry
          }
        },
        3,
        1000
      ); // 3 retries for individual guilds, 1 second delay
    }
  } catch (error) {
    console.error("❌ Error announcing matches:", error);
    throw error;
  }
}

// Run the script
main();
