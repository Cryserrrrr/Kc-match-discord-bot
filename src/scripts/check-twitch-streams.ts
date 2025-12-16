#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { Client } from "discord.js";
import { config } from "dotenv";
import { logger } from "../utils/logger";
import { TwitchService } from "../services/twitch";
import { sendTwitchStreamNotification } from "../utils/notificationUtils";
import { ClientManager } from "../utils/clientManager";

config();

async function main() {
  let prisma: PrismaClient | null = null;
  let client: Client | null = null;

  try {
    prisma = ClientManager.getPrismaClient();
    client = await ClientManager.getDiscordClient();

    const twitchService = new TwitchService();

    logger.info("Checking Twitch streams for players...");

    const activePlayers = await prisma.twitchPlayer.findMany({
      where: {
        isActive: true,
      },
    });

    if (activePlayers.length === 0) {
      logger.info("No active Twitch players found");
      return;
    }

    logger.info(`Found ${activePlayers.length} active players to check`);

    const twitchLogins = activePlayers
      .map((player: { twitchLogin: string }) => player.twitchLogin)
      .filter((login: string) => login);

    if (twitchLogins.length === 0) {
      logger.info("No Twitch logins found for active players");
      return;
    }

    const streams = await twitchService.getStreamsByUserLogins(twitchLogins);

    logger.info(`Found ${streams.length} live streams`);

    const guildSettings = await prisma.guildSettings.findMany({
      where: {
        enableTwitchNotifications: true,
      },
    });

    if (guildSettings.length === 0) {
      logger.info("No guilds with Twitch notifications enabled");
    }

    for (const stream of streams) {
      const player = activePlayers.find(
        (p: { twitchLogin: string }) => p.twitchLogin.toLowerCase() === stream.user_login.toLowerCase()
      );

      if (!player) {
        logger.warn(
          `Player not found for stream ${stream.user_login}, skipping`
        );
        continue;
      }

      const existingStream = await prisma.twitchStream.findUnique({
        where: { userId: stream.user_id },
      });

      if (existingStream) {
        await prisma.twitchStream.update({
          where: { userId: stream.user_id },
          data: {
            viewerCount: stream.viewer_count,
            gameName: stream.game_name,
            gameId: stream.game_id,
            title: stream.title,
            thumbnailUrl: stream.thumbnail_url,
            updatedAt: new Date(),
          },
        });
        logger.info(`Updated stream for ${player.playerName} (${player.teamName})`);
      } else {
        await prisma.twitchStream.create({
          data: {
            id: stream.id,
            userId: stream.user_id,
            userLogin: stream.user_login,
            userName: stream.user_name,
            gameId: stream.game_id,
            gameName: stream.game_name,
            title: stream.title,
            viewerCount: stream.viewer_count,
            startedAt: new Date(stream.started_at),
            thumbnailUrl: stream.thumbnail_url,
          },
        });

        logger.info(
          `New stream detected: ${player.playerName} (${player.teamName})`
        );

        if (guildSettings.length > 0 && client) {
          await sendTwitchStreamNotification(
            client,
            guildSettings,
            stream,
            player.playerName,
            player.teamId,
            player.teamName,
            twitchService
          );
        }
      }
    }

    const activeStreamUserIds = streams.map((s) => s.user_id);
    const endedStreams = await prisma.twitchStream.findMany({
      where: {
        userId: {
          notIn: activeStreamUserIds,
        },
      },
    });

    for (const endedStream of endedStreams) {
      await prisma.twitchStream.delete({
        where: { userId: endedStream.userId },
      });
      logger.info(`Stream ended for user ${endedStream.userName}`);
    }
  } catch (error) {
    logger.error("Error checking Twitch streams:", error);
    process.exit(1);
  } finally {
    await ClientManager.cleanup();
    process.exit(0);
  }
}

main();


