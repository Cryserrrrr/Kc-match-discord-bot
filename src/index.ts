import {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
} from "discord.js";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { loadCommands } from "./commands/commandLoader";
import { logger } from "./utils/logger";
import { createMatchEmbed } from "./utils/embedBuilder";
import { getTeamDisplayName } from "./utils/teamMapper";
import { CONFIG, ERROR_MESSAGES } from "./utils/config";
import {
  safeInteractionDefer,
  safeInteractionReply,
  withTimeout,
} from "./utils/timeoutUtils";
import { getStreamingUrl } from "./utils/casters";

config();

export const prisma = new PrismaClient();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
}) as Client & { commands: Collection<string, any> };

client.commands = new Collection();

client.once("ready", async () => {
  logger.info(`Bot logged in as ${client.user?.tag}`);

  try {
    await loadCommands(client);
    logger.info("Commands loaded successfully");

    await updateBotStatus();
    setInterval(updateBotStatus, 5 * 60 * 1000);
  } catch (error) {
    logger.error("Error during bot initialization:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await safeInteractionDefer(interaction);

      await command.execute(interaction);
    } catch (error) {
      logger.error(
        `Error executing command ${interaction.commandName}:`,
        error
      );
      await sendErrorMessage(
        interaction,
        ERROR_MESSAGES.GENERAL.COMMAND_EXECUTION_ERROR
      );
    }
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "team_select"
  ) {
    try {
      await safeInteractionDefer(interaction);

      await handleTeamSelect(interaction);
    } catch (error) {
      logger.error("Error handling team select:", error);
      await sendErrorMessage(
        interaction,
        ERROR_MESSAGES.GENERAL.INTERACTION_ERROR
      );
    }
  }
});

async function handleTeamSelect(interaction: any) {
  const selectedTeam = interaction.values[0];
  const guildId = interaction.guildId!;

  try {
    const guildSettings = await withTimeout(
      prisma.guildSettings.findUnique({
        where: { guildId },
      }),
      CONFIG.TIMEOUTS.DATABASE_QUERY,
      ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
    );

    const filteredTeams = (guildSettings as any)?.filteredTeams || [];

    const whereClause: any = {
      beginAt: { gte: new Date() },
    };

    if (selectedTeam !== "all") {
      whereClause.kcId = selectedTeam;
    } else if (filteredTeams.length > 0) {
      whereClause.kcId = { in: filteredTeams };
    }

    const nextMatch = await withTimeout(
      prisma.match.findFirst({
        where: whereClause,
        orderBy: { beginAt: "asc" },
      }),
      CONFIG.TIMEOUTS.DATABASE_QUERY,
      ERROR_MESSAGES.TIMEOUT.DATABASE_QUERY
    );

    if (!nextMatch) {
      const teamText =
        selectedTeam === "all"
          ? "Karmine Corp"
          : getTeamDisplayName(selectedTeam);
      await safeInteractionReply(interaction, {
        content: `Aucun match à venir trouvé pour ${teamText}! 🏆`,
      });
      return;
    }

    const embed = await createMatchEmbed({
      kcTeam: nextMatch.kcTeam,
      kcId: nextMatch.kcId,
      opponent: nextMatch.opponent,
      opponentImage: nextMatch.opponentImage || undefined,
      tournamentName: nextMatch.tournamentName,
      leagueName: nextMatch.leagueName,
      leagueImage: nextMatch.leagueImage || undefined,
      serieName: nextMatch.serieName,
      numberOfGames: nextMatch.numberOfGames,
      beginAt: nextMatch.beginAt,
    });

    const response = { embeds: [embed] };
    await safeInteractionReply(interaction, response);
  } catch (error) {
    logger.error("Error in handleTeamSelect:", error);
    throw error;
  }
}

async function sendErrorMessage(interaction: any, message: string) {
  try {
    await safeInteractionReply(interaction, {
      content: message,
      ephemeral: true,
    });
  } catch (error) {
    logger.error("Error sending error message:", error);
  }
}

async function updateBotStatus() {
  try {
    const liveMatch = await prisma.match.findFirst({
      where: {
        status: "live",
      },
      orderBy: {
        beginAt: "asc",
      },
    });

    if (liveMatch) {
      const statusText = `${liveMatch.kcTeam} vs ${liveMatch.opponent}`;
      const streamingUrl = getStreamingUrl(liveMatch.leagueName);

      if (streamingUrl) {
        client.user?.setActivity(statusText, {
          type: ActivityType.Streaming,
          url: streamingUrl,
        });
        logger.debug(
          `Updated bot status to: Streaming ${statusText} on ${streamingUrl}`
        );
      } else {
        client.user?.setActivity(statusText, {
          type: ActivityType.Streaming,
          url: "https://www.twitch.tv/kamet0",
        });
        logger.debug(
          `Updated bot status to: Streaming ${statusText} (no streaming URL found)`
        );
      }
    } else {
      client.user?.setPresence({ activities: [] });
      logger.debug("Cleared bot status - no live matches");
    }
  } catch (error) {
    logger.error("Error updating bot status:", error);
  }
}

client.on("error", (error) => {
  logger.error("Discord client error:", error);
});

// Gestionnaire pour quand le bot est supprimé d'un serveur
client.on("guildDelete", async (guild) => {
  try {
    logger.info(`Bot removed from guild: ${guild.name} (${guild.id})`);

    // Supprimer les paramètres du serveur de la base de données
    await prisma.guildSettings.deleteMany({
      where: {
        guildId: guild.id,
      },
    });

    logger.info(
      `Guild settings deleted for guild: ${guild.name} (${guild.id})`
    );
  } catch (error) {
    logger.error(`Error deleting guild settings for guild ${guild.id}:`, error);
  }
});

process.on("SIGINT", async () => {
  logger.info("Shutting down bot...");
  try {
    await prisma.$disconnect();
    await client.destroy();
  } catch (error) {
    logger.error("Error during shutdown:", error);
  }
  process.exit(0);
});

process.on("SIGTERM", async () => {
  logger.info("Shutting down bot...");
  try {
    await prisma.$disconnect();
    await client.destroy();
  } catch (error) {
    logger.error("Error during shutdown:", error);
  }
  process.exit(0);
});

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", promise, "reason:", reason);
  process.exit(1);
});

client.login(process.env.DISCORD_TOKEN);
