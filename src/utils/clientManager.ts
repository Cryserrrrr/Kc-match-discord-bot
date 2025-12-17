import { PrismaClient } from "@prisma/client";
import { Client, GatewayIntentBits } from "discord.js";
import { logger } from "./logger";
import { withRetry } from "./retryUtils";

export class ClientManager {
  private static prismaInstance: PrismaClient | null = null;
  private static discordInstance: Client | null = null;
  private static isDiscordReady = false;

  static getPrismaClient(): PrismaClient {
    if (!this.prismaInstance) {
      this.prismaInstance = new PrismaClient({
        datasources: {
          db: {
            url: process.env.DATABASE_URL,
          },
        },
        log: ["error", "warn"],
      });
    }
    return this.prismaInstance;
  }

  static async getDiscordClient(): Promise<Client> {
    if (!this.discordInstance) {
      this.discordInstance = new Client({
        intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
      });
    }

    if (!this.isDiscordReady) {
      await withRetry(
        async () => {
          try {
            await this.discordInstance!.login(process.env.DISCORD_TOKEN);
            this.isDiscordReady = true;
            logger.info(`Logged in as ${this.discordInstance!.user?.tag}`);
          } catch (error: any) {
            if (
              error.message?.includes("sessions remaining") ||
              error.message?.includes("rate limit") ||
              error.message?.includes("resets at")
            ) {
              logger.warn(
                "Discord session rate limit reached. Please wait before retrying."
              );
              throw error;
            }
            logger.error("Failed to login to Discord:", error);
            throw error;
          }
        },
        { maxRetries: 3, initialDelay: 5000 }
      );
    }

    return this.discordInstance;
  }

  static async checkDatabaseConnection(): Promise<void> {
    const prisma = this.getPrismaClient();
    await withRetry(async () => {
      await prisma.$queryRaw`SELECT 1`;
    });
  }

  static async cleanup(): Promise<void> {
    try {
      if (this.prismaInstance) {
        await this.prismaInstance.$disconnect();
        this.prismaInstance = null;
        logger.info("Prisma client disconnected");
      }

      if (this.discordInstance && this.isDiscordReady) {
        await this.discordInstance.destroy();
        this.discordInstance = null;
        this.isDiscordReady = false;
        logger.info("Discord client disconnected");
      }
    } catch (error) {
      logger.error("Error during client cleanup:", error);
    }
  }

  static reset(): void {
    this.prismaInstance = null;
    this.discordInstance = null;
    this.isDiscordReady = false;
  }
}
