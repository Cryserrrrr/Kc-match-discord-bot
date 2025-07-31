import { Client, GatewayIntentBits, Collection } from "discord.js";
import { config } from "dotenv";
import { PrismaClient } from "@prisma/client";
import { loadCommands } from "./commands/commandLoader";
import { logger } from "./utils/logger";
import { createMatchEmbed } from "./utils/embedBuilder";
import { getTeamDisplayName } from "./utils/teamMapper";

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
  } catch (error) {
    logger.error("Error during bot initialization:", error);
  }
});

client.on("interactionCreate", async (interaction) => {
  if (interaction.isChatInputCommand()) {
    const command = client.commands.get(interaction.commandName);
    if (!command) return;

    try {
      await command.execute(interaction);
    } catch (error) {
      logger.error(
        `Error executing command ${interaction.commandName}:`,
        error
      );
      await sendErrorMessage(
        interaction,
        "Une erreur s'est produite lors de l'exécution de cette commande !"
      );
    }
  }

  if (
    interaction.isStringSelectMenu() &&
    interaction.customId === "team_select"
  ) {
    try {
      await handleTeamSelect(interaction);
    } catch (error) {
      logger.error("Error handling team select:", error);
      await sendErrorMessage(
        interaction,
        "Une erreur s'est produite lors de la sélection de l'équipe."
      );
    }
  }
});

async function handleTeamSelect(interaction: any) {
  const selectedTeam = interaction.values[0];
  const guildId = interaction.guildId!;
  const guildSettings = await prisma.guildSettings.findUnique({
    where: { guildId },
  });
  const filteredTeams = (guildSettings as any)?.filteredTeams || [];

  const whereClause: any = {
    beginAt: { gte: new Date() },
  };

  if (selectedTeam !== "all") {
    whereClause.kcId = selectedTeam;
  } else if (filteredTeams.length > 0) {
    whereClause.kcId = { in: filteredTeams };
  }

  const nextMatch = await prisma.match.findFirst({
    where: whereClause,
    orderBy: { beginAt: "asc" },
  });

  if (!nextMatch) {
    const teamText =
      selectedTeam === "all"
        ? "Karmine Corp"
        : getTeamDisplayName(selectedTeam);
    await interaction.reply({
      content: `Aucun match à venir trouvé pour ${teamText}! 🏆`,
      flags: 64,
    });
    return;
  }

  try {
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

    const response = { embeds: [embed], flags: 64 };
    await sendResponse(interaction, response);
  } catch (error) {
    logger.error("Error creating match embed:", error);
    const fallbackMessage = `Match trouvé : ${nextMatch.kcTeam} vs ${
      nextMatch.opponent
    } le ${nextMatch.beginAt.toLocaleDateString("fr-FR")}`;
    await sendResponse(interaction, { content: fallbackMessage, flags: 64 });
  }
}

async function sendResponse(interaction: any, response: any) {
  if (!interaction.replied && !interaction.deferred) {
    await interaction.reply(response);
  } else {
    await interaction.editReply(response);
  }
}

async function sendErrorMessage(interaction: any, message: string) {
  try {
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: message, flags: 64 });
    } else if (interaction.deferred) {
      await interaction.editReply({ content: message });
    }
  } catch (error) {
    logger.error("Error sending error message:", error);
  }
}

client.on("error", (error) => {
  logger.error("Discord client error:", error);
});

process.on("SIGINT", async () => {
  logger.info("Shutting down bot...");
  await prisma.$disconnect();
  process.exit(0);
});

client.login(process.env.DISCORD_TOKEN);
