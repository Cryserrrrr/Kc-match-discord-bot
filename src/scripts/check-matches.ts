#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { config } from "dotenv";
import { createMatchEmbed } from "../utils/embedBuilder";

// Load environment variables
config();

async function main() {
  console.log("🔍 Starting 24h match check from database...");

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

    // Cleanup
    await prisma.$disconnect();
    await client.destroy();

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during 24h match check:", error);
    process.exit(1);
  }
}

async function getMatchesNext24Hours(prisma: PrismaClient) {
  const now = new Date();
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const matches = await prisma.match.findMany({
    where: {
      beginAt: {
        gte: now,
        lte: tomorrow,
      },
      announced: false,
    },
    orderBy: {
      beginAt: "asc",
    },
  });

  console.log(`📊 Found ${matches.length} unannounced matches in database`);

  // Log each match found
  matches.forEach((match, index) => {
    console.log(
      `${index + 1}. ${match.kcTeam} vs ${match.opponent} - ${new Date(
        match.beginAt
      ).toLocaleString("fr-FR")}`
    );
  });

  return matches;
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
          // Send the custom message first
          await channel.send(settings.customMessage);

          // Send each match as an embed
          for (const match of matches) {
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
          }

          console.log(
            `✅ Successfully announced ${matches.length} matches in guild ${guild.name}`
          );
        }
      } catch (error) {
        console.error(
          `❌ Failed to announce matches in guild ${settings.guildId}:`,
          error
        );
      }
    }

    // Mark all matches as announced
    const matchIds = matches.map((match) => match.id);
    await prisma.match.updateMany({
      where: {
        id: {
          in: matchIds,
        },
      },
      data: {
        announced: true,
      },
    });

    console.log(`✅ Marked ${matches.length} matches as announced in database`);
  } catch (error) {
    console.error("❌ Error announcing matches:", error);
    throw error;
  }
}

// Run the script
main();
