import {
  Client,
  GatewayIntentBits,
  Collection,
  ActivityType,
  AuditLogEvent,
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
import { PandaScoreService } from "./services/pandascore";
import { handleTicketModalSubmit } from "./commands/ticket";

config();

export const prisma = new PrismaClient();

export const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages],
}) as Client & { commands: Collection<string, any> };

client.commands = new Collection();

// Constants for repeated content
const COMMANDS_LIST =
  "• `/nextmatch` - Voir le prochain match\n• `/standing` - Voir les classements\n• `/ticket` - Créer un ticket de support\n• `/mytickets` - Voir vos tickets\n• `/config` - Configurer le bot";

const CONFIG_DESCRIPTION =
  "Utilisez `/config` pour définir :\n• Le canal d'annonce des matchs\n• Les rôles à mentionner\n• Les équipes à suivre\n• Les notifications avant-match, de score et de mise à jour";

const createWelcomeEmbed = (guildName: string, isDM: boolean = false) => ({
  color: 0x00ff00,
  title: isDM
    ? "🎉 Merci d'avoir ajouté le Bot Karmine Corp !"
    : "🎉 Bot Karmine Corp ajouté avec succès !",
  description: `Le bot a été ajouté ${
    isDM ? "avec succès au serveur" : "au serveur"
  } **${guildName}** !`,
  fields: [
    {
      name: "⚙️ Configuration requise",
      value: isDM
        ? "Pour que les messages automatiques fonctionnent correctement, vous devez configurer le bot avec la commande `/config`."
        : "Pour que les messages automatiques fonctionnent correctement, un administrateur doit configurer le bot avec la commande `/config`.",
      inline: false,
    },
    {
      name: "📋 Commandes disponibles",
      value: COMMANDS_LIST,
      inline: false,
    },
    {
      name: "🔧 Configuration",
      value: CONFIG_DESCRIPTION,
      inline: false,
    },
  ],
  footer: {
    text: "Bot Karmine Corp - Configuration automatique",
  },
  timestamp: new Date().toISOString(),
});

const handleShutdown = async () => {
  logger.info("Shutting down bot...");
  try {
    await prisma.$disconnect();
    await client.destroy();
  } catch (error) {
    logger.error("Error during shutdown:", error);
  }
  process.exit(0);
};

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
      if (interaction.commandName !== "ticket") {
        await safeInteractionDefer(interaction);
      }

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

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "tournament_select"
  ) {
    try {
      await safeInteractionDefer(interaction);

      await handleTournamentSelect(interaction);
    } catch (error) {
      logger.error("Error handling tournament select:", error);
      await sendErrorMessage(
        interaction,
        ERROR_MESSAGES.GENERAL.INTERACTION_ERROR
      );
    }
  }

  if (
    interaction.isModalSubmit() &&
    interaction.customId.startsWith("ticket_modal_")
  ) {
    try {
      await handleTicketModalSubmit(interaction);
    } catch (error) {
      logger.error("Error handling ticket modal submit:", error);
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
        content: `No upcoming match found for ${teamText}! 🏆`,
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

async function handleTournamentSelect(interaction: any) {
  const selectedTournamentId = interaction.values[0];

  try {
    const match = await prisma.match.findFirst({
      where: { tournamentId: selectedTournamentId },
      select: {
        tournamentId: true,
        tournamentName: true,
        hasBracket: true,
      },
    });

    if (!match) {
      await safeInteractionReply(interaction, {
        content: "Tournament not found! 🏆",
      });
      return;
    }

    const tournament = {
      id: match.tournamentId!,
      name: match.tournamentName,
      hasBracket: match.hasBracket,
    };

    const cachedData = await prisma.standingCache.findFirst({
      where: {
        tournamentId: tournament.id,
        expiresAt: { gt: new Date() },
      },
    });

    if (cachedData) {
      const data = JSON.parse(cachedData.data);
      await sendStandingEmbed(interaction, tournament, data);
      return;
    }

    const pandaScoreService = new PandaScoreService();
    let data;

    if (tournament.hasBracket) {
      data = await pandaScoreService.getTournamentBrackets(tournament.id);
    } else {
      data = await pandaScoreService.getTournamentStandings(tournament.id);
    }

    await prisma.standingCache.create({
      data: {
        tournamentId: tournament.id,
        data: JSON.stringify(data),
        expiresAt: new Date(Date.now() + 5 * 60 * 1000),
      },
    });

    await sendStandingEmbed(interaction, tournament, data);
  } catch (error) {
    logger.error("Error in handleTournamentSelect:", error);
    await safeInteractionReply(interaction, {
      content: "Error retrieving standings. Please try again later.",
    });
  }
}

async function sendStandingEmbed(interaction: any, tournament: any, data: any) {
  const { EmbedBuilder } = await import("discord.js");

  const embed = new EmbedBuilder()
    .setTitle(`🏆 ${tournament.name}`)
    .setColor(0x0099ff)
    .setTimestamp();

  if (tournament.hasBracket) {
    embed.setDescription("📊 **Tournament Bracket**");

    if (Array.isArray(data) && data.length > 0) {
      const matches = data.slice(0, 15);

      let bracketText = "";
      matches.forEach((match: any, index: number) => {
        const status =
          match.status === "finished"
            ? "✅"
            : match.status === "live"
            ? "🔴"
            : "⏳";

        let matchText = `${status} **${match.name}**\n`;

        if (match.opponents && match.opponents.length > 0) {
          const team1 = match.opponents[0]?.opponent?.name || "TBD";
          const team2 = match.opponents[1]?.opponent?.name || "TBD";
          const score1 = match.results?.[0]?.score || 0;
          const score2 = match.results?.[1]?.score || 0;

          matchText += `   ${team1} ${score1} - ${score2} ${team2}\n`;
        } else {
          matchText += `   TBD vs TBD\n`;
        }

        if (match.begin_at) {
          const matchDate = new Date(match.begin_at);
          matchText += `   📅 ${matchDate.toLocaleDateString()} ${matchDate.toLocaleTimeString()}\n`;
        }

        bracketText += matchText + "\n";
      });

      embed.addFields({
        name: "Matches",
        value: bracketText || "No matches found",
        inline: false,
      });
    }
  } else {
    embed.setDescription("📈 **Tournament Standings**");

    if (Array.isArray(data) && data.length > 0) {
      const standings = data.slice(0, 10);

      let standingText = "";
      standings.forEach((team: any) => {
        const position = team.position;
        const name = team.team.name;
        const points = team.points || 0;
        const wins = team.wins || 0;
        const losses = team.losses || 0;

        const medal =
          position === 1
            ? "🥇"
            : position === 2
            ? "🥈"
            : position === 3
            ? "🥉"
            : `${position}.`;

        standingText += `${medal} **${name}** - ${points}pts (${wins}W/${losses}L)\n`;
      });

      embed.addFields({
        name: "Standings",
        value: standingText || "No standings found",
        inline: false,
      });
    }
  }

  await safeInteractionReply(interaction, { embeds: [embed] });
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

client.on("guildCreate", async (guild) => {
  try {
    logger.info(`Bot added to guild: ${guild.name} (${guild.id})`);

    await prisma.guildSettings.upsert({
      where: { guildId: guild.id },
      update: {
        name: guild.name,
        memberCount: guild.memberCount,
        updatedAt: new Date(),
      },
      create: {
        guildId: guild.id,
        name: guild.name,
        memberCount: guild.memberCount,
        channelId: "",
      },
    });

    let welcomeMessageSent = false;

    const botMember = guild.members.me;
    const hasAuditLogPermission = botMember?.permissions.has("ViewAuditLog");

    if (hasAuditLogPermission) {
      try {
        const auditLogs = await guild.fetchAuditLogs({
          type: AuditLogEvent.BotAdd,
          limit: 1,
        });

        const botAddLog = auditLogs.entries.first();
        if (botAddLog && botAddLog.executor) {
          const executor = botAddLog.executor;

          try {
            await executor.send({
              embeds: [createWelcomeEmbed(guild.name, true)],
            });

            logger.info(
              `Welcome message sent to ${executor.tag} for guild ${guild.name}`
            );
            welcomeMessageSent = true;
          } catch (dmError) {
            logger.warn(`Could not send DM to ${executor.tag}:`, dmError);
          }
        }
      } catch (auditError) {
        logger.warn(
          `Could not access audit logs for guild ${guild.name}:`,
          auditError
        );
      }
    } else {
      logger.info(
        `Bot does not have ViewAuditLog permission in guild ${guild.name}, will use fallback method`
      );
    }

    if (!welcomeMessageSent) {
      try {
        const textChannels = guild.channels.cache.filter(
          (channel) =>
            channel.type === 0 &&
            channel.permissionsFor(guild.members.me!)?.has("SendMessages")
        );

        if (textChannels.size > 0) {
          const firstChannel = textChannels.first();
          if (firstChannel && firstChannel.isTextBased()) {
            await firstChannel.send({
              embeds: [createWelcomeEmbed(guild.name, false)],
            });

            logger.info(
              `Welcome message sent to channel #${firstChannel.name} in guild ${guild.name}`
            );
          }
        }
      } catch (channelError) {
        logger.warn(
          `Could not send welcome message to any channel in guild ${guild.name}:`,
          channelError
        );
      }
    }

    logger.info(
      `Guild settings created for guild: ${guild.name} (${guild.id})`
    );
  } catch (error) {
    logger.error(`Error handling guild create for guild ${guild.id}:`, error);
  }
});

client.on("guildDelete", async (guild) => {
  try {
    logger.info(`Bot removed from guild: ${guild.name} (${guild.id})`);

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
  await handleShutdown();
});

process.on("SIGTERM", async () => {
  await handleShutdown();
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
