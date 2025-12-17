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

    if (streams.length === 0) {
      const activeStreamUserIds: string[] = [];
      const endedStreams = await prisma.twitchStream.findMany({
        where: {
          userId: {
            notIn: activeStreamUserIds,
          },
        },
      });

      if (endedStreams.length > 0) {
        await prisma.twitchStream.deleteMany({
          where: {
            userId: {
              notIn: activeStreamUserIds,
            },
          },
        });
        logger.info(`Deleted ${endedStreams.length} ended streams`);
      }
      return;
    }

    const streamUserIds = streams.map((s) => s.user_id);
    const existingStreams = await prisma.twitchStream.findMany({
      where: {
        userId: {
          in: streamUserIds,
        },
      },
    });

    const existingStreamMap = new Map(
      existingStreams.map((s) => [s.userId, s])
    );

    const playerMap = new Map(
      activePlayers.map((p) => [p.twitchLogin.toLowerCase(), p])
    );

    const guildSettings = await prisma.guildSettings.findMany({
      where: {
        enableTwitchNotifications: true,
      },
    });

    if (guildSettings.length === 0) {
      logger.info("No guilds with Twitch notifications enabled");
    }

    const streamsToUpdate: Array<{
      userId: string;
      data: {
        viewerCount: number;
        gameName: string;
        gameId: string;
        title: string;
        thumbnailUrl: string;
        updatedAt: Date;
      };
    }> = [];

    const streamsToCreate: Array<{
      id: string;
      userId: string;
      userLogin: string;
      userName: string;
      gameId: string;
      gameName: string;
      title: string;
      viewerCount: number;
      startedAt: Date;
      thumbnailUrl: string;
      player: { playerName: string; teamId: string; teamName: string };
    }> = [];

    for (const stream of streams) {
      const player = playerMap.get(stream.user_login.toLowerCase());

      if (!player) {
        logger.warn(
          `Player not found for stream ${stream.user_login}, skipping`
        );
        continue;
      }

      const existingStream = existingStreamMap.get(stream.user_id);

      if (existingStream) {
        streamsToUpdate.push({
          userId: stream.user_id,
          data: {
            viewerCount: stream.viewer_count,
            gameName: stream.game_name,
            gameId: stream.game_id,
            title: stream.title,
            thumbnailUrl: stream.thumbnail_url,
            updatedAt: new Date(),
          },
        });
      } else {
        streamsToCreate.push({
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
          player: {
            playerName: player.playerName,
            teamId: player.teamId,
            teamName: player.teamName,
          },
        });
      }
    }

    if (streamsToUpdate.length > 0) {
      await Promise.all(
        streamsToUpdate.map((s) =>
          prisma.twitchStream.update({
            where: { userId: s.userId },
            data: s.data,
          })
        )
      );
      logger.info(`Updated ${streamsToUpdate.length} existing streams`);
    }

    if (streamsToCreate.length > 0) {
      await Promise.all(
        streamsToCreate.map((s) =>
          prisma.twitchStream.create({
            data: {
              id: s.id,
              userId: s.userId,
              userLogin: s.userLogin,
              userName: s.userName,
              gameId: s.gameId,
              gameName: s.gameName,
              title: s.title,
              viewerCount: s.viewerCount,
              startedAt: s.startedAt,
              thumbnailUrl: s.thumbnailUrl,
            },
          })
        )
      );

      logger.info(`Created ${streamsToCreate.length} new streams`);

      if (guildSettings.length > 0) {
        try {
          client = await ClientManager.getDiscordClient();
        } catch (error: any) {
          if (
            error.message?.includes("sessions remaining") ||
            error.message?.includes("rate limit") ||
            error.message?.includes("resets at")
          ) {
            logger.warn(
              "Discord rate limit reached, skipping notifications this run. Will retry on next execution."
            );
            client = null;
          } else {
            throw error;
          }
        }

        if (client) {
          for (const streamData of streamsToCreate) {
            const stream = streams.find((s) => s.user_id === streamData.userId);
            if (stream) {
              await sendTwitchStreamNotification(
                client,
                guildSettings,
                stream,
                streamData.player.playerName,
                streamData.player.teamId,
                streamData.player.teamName,
                twitchService
              );
            }
          }
        }
      }
    }

    const endedStreams = await prisma.twitchStream.findMany({
      where: {
        userId: {
          notIn: streamUserIds,
        },
      },
    });

    if (endedStreams.length > 0) {
      await prisma.twitchStream.deleteMany({
        where: {
          userId: {
            notIn: streamUserIds,
          },
        },
      });
      logger.info(`Deleted ${endedStreams.length} ended streams`);
    }
  } catch (error: any) {
    if (
      error.message?.includes("sessions remaining") ||
      error.message?.includes("rate limit")
    ) {
      logger.warn(
        "Discord rate limit reached. The script will retry on next execution."
      );
      process.exit(0);
    } else {
      logger.error("Error checking Twitch streams:", error);
      process.exit(1);
    }
  } finally {
    if (client) {
      try {
        await ClientManager.cleanup();
      } catch (cleanupError) {
        logger.warn("Error during cleanup:", cleanupError);
      }
    } else {
      if (prisma) {
        try {
          await prisma.$disconnect();
        } catch (cleanupError) {
          logger.warn("Error disconnecting Prisma:", cleanupError);
        }
      }
    }
    process.exit(0);
  }
}

main();


