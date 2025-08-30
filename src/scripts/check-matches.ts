#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits, TextChannel } from "discord.js";
import { config } from "dotenv";
import { logger } from "../utils/logger";
import {
  sendDailyMatchAnnouncement,
  sendNoMatchesAnnouncement,
} from "../utils/notificationUtils";

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
      console.error(`❌ Attempt ${attempt} failed:`, error);

      if (attempt === maxRetries) {
        console.error(
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
  let client: Client | null = null;

  try {
    await withRetry(async () => {
      prisma = new PrismaClient();
      await prisma.$queryRaw`SELECT 1`;
    });

    await withRetry(async () => {
      client = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      });

      const loginPromise = client.login(process.env.DISCORD_TOKEN);
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Discord login timeout")), 30000)
      );

      await Promise.race([loginPromise, timeoutPromise]);

      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error("Client ready timeout"));
        }, 30000);

        client!.once("ready", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    });

    const matches = await withRetry(async () => {
      if (!prisma) throw new Error("Prisma client not initialized");
      return await getMatchesNext24Hours(prisma);
    });

    if (matches.length === 0) {
      logger.info("📭 No matches found for the next 24 hours in database");
      await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        const guildSettings = await prisma.guildSettings.findMany();
        await sendNoMatchesAnnouncement(client, guildSettings);
      });
    } else {
      logger.info(
        `📅 Found ${matches.length} matches for the next 24 hours in database`
      );

      const hasAnnouncements = await withRetry(async () => {
        if (!client || !prisma) throw new Error("Clients not initialized");
        const guildSettings = await prisma.guildSettings.findMany();
        return await sendDailyMatchAnnouncement(client, guildSettings, matches);
      });

      if (!hasAnnouncements) {
        logger.info(
          "📭 No guilds received match announcements - sending no matches message"
        );
        await withRetry(async () => {
          if (!client || !prisma) throw new Error("Clients not initialized");
          const guildSettings = await prisma.guildSettings.findMany();
          await sendNoMatchesAnnouncement(client, guildSettings);
        });
      }
    }
  } catch (error) {
    logger.error("💥 CRITICAL ERROR - Script failed after all retries:", error);
    process.exit(1);
  } finally {
    try {
      if (prisma) {
        await (prisma as PrismaClient).$disconnect();
      }
      if (client) {
        await (client as Client).destroy();
      }
    } catch (cleanupError) {
      logger.error("❌ Error during cleanup:", cleanupError);
    }

    process.exit(0);
  }
}

async function getMatchesNext24Hours(prisma: PrismaClient) {
   const now = new Date();
   const dateMinusOne = new Date(now);
dateMinusOne.setMinutes(dateMinusOne.getMinutes() - 1);

  const tomorrow = new Date(dateMinusOne);
  tomorrow.setDate(tomorrow.getDate() + 1);

  try {
    const matches = await prisma.match.findMany({
      where: {
        beginAt: {
          gte: dateMinusOne,
          lte: tomorrow,
        },
      },
      orderBy: {
        beginAt: "asc",
      },
    });

    return matches;
  } catch (error) {
    logger.error("❌ Error fetching matches from database:", error);
    throw error;
  }
}

main();
