#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { config } from "dotenv";
import { createMatchEmbed } from "../utils/embedBuilder";

// Load environment variables
config();

async function main() {
  console.log("🔍 Starting 24h match check from database...");

  let prisma: PrismaClient | null = null;
  let client: Client | null = null;

  try {
    // Initialize Prisma
    prisma = new PrismaClient();

    // Create Discord client
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

    console.log(
      "🔍 Checking for matches in the next 24 hours from database..."
    );

    // Get matches for next 24 hours from database
    const matches = await getMatchesNext24Hours(prisma);

    if (matches.length === 0) {
      console.log("📭 No matches found for the next 24 hours in database");
      // Send "no matches" message to all configured channels
      await announceNoMatches(client, prisma);
    } else {
      console.log(
        `📅 Found ${matches.length} matches for the next 24 hours in database`
      );

      // Announce all matches
      await announceAllMatches(client, prisma, matches);
    }

    console.log("✅ 24h match check completed successfully");
  } catch (error) {
    console.error("❌ Error during 24h match check:", error);
    process.exit(1);
  } finally {
    // Cleanup
    try {
      if (prisma) {
        await prisma.$disconnect();
      }
      if (client) {
        await client.destroy();
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
      try {
        const guild = await client.guilds.fetch(settings.guildId);
        const channel = await guild.channels.fetch(settings.channelId);

        if (channel instanceof TextChannel) {
          await channel.send("🔔 Pas de match aujourd'hui");
          console.log(`✅ Sent "no matches" message in guild ${guild.name}`);
        }
      } catch (error) {
        console.error(
          `❌ Failed to send "no matches" message in guild ${settings.guildId}:`,
          error
        );
        // Continue with next guild instead of failing completely
      }
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
              console.error(`❌ Error sending match ${match.id}:`, matchError);
              // Continue with next match instead of failing completely
            }
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
        // Continue with next guild instead of failing completely
      }
    }
  } catch (error) {
    console.error("❌ Error announcing matches:", error);
    throw error;
  }
}

// Run the script
main();
