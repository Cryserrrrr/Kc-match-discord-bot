import {
  SlashCommandBuilder,
  CommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { createMatchEmbed } from "../utils/embedBuilder";
import { getTeamDisplayName } from "../utils/teamMapper";
import { createTeamChoices, createTeamMenuOptions } from "../utils/teamOptions";
import { filterMatchesByGuild } from "../utils/guildFilters";
import { handleInteractionError } from "../utils/retryUtils";

export const data = new SlashCommandBuilder()
  .setName("nextmatch")
  .setDescription("Afficher le prochain match de Karmine Corp")
  .addStringOption((option: any) =>
    option
      .setName("team")
      .setDescription("Choisir une équipe spécifique de Karmine Corp")
      .setRequired(false)
      .addChoices(
        { name: "Toutes les équipes", value: "all" },
        ...createTeamChoices()
      )
  );

export async function execute(interaction: CommandInteraction) {
  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply();
    }

    const selectedTeam =
      (interaction as any).options?.getString("team") || "all";

    const guildId = interaction.guildId!;
    let guildSettings;

    try {
      guildSettings = await prisma.guildSettings.findUnique({
        where: { guildId },
      });
    } catch (dbError) {
      logger.error("Error fetching guild settings:", dbError);
      await interaction.editReply(
        "Erreur lors de la récupération des paramètres du serveur."
      );
      return;
    }

    const filteredTeams = (guildSettings as any)?.filteredTeams || [];

    const whereClause: any = {
      beginAt: {
        gte: new Date(),
      },
    };

    if (selectedTeam !== "all") {
      whereClause.kcId = selectedTeam;
    } else if (filteredTeams.length > 0) {
      whereClause.kcId = {
        in: filteredTeams,
      };
    }

    let nextMatch;
    try {
      nextMatch = await prisma.match.findFirst({
        where: whereClause,
        orderBy: {
          beginAt: "asc",
        },
      });
    } catch (dbError) {
      logger.error("Error fetching next match:", dbError);
      await interaction.editReply(
        "Erreur lors de la récupération du prochain match."
      );
      return;
    }

    if (!nextMatch) {
      let teamText: string;
      if (selectedTeam === "all") {
        if (filteredTeams.length > 0) {
          const teamNames = filteredTeams.map((id: string) =>
            getTeamDisplayName(id)
          );
          teamText = teamNames.join(", ");
        } else {
          teamText = "Karmine Corp";
        }
      } else {
        teamText = getTeamDisplayName(selectedTeam);
      }
      await interaction.editReply(
        `Aucun match à venir trouvé pour ${teamText}! 🏆`
      );
      return;
    }

    let embed;
    try {
      embed = await createMatchEmbed({
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
    } catch (embedError) {
      logger.error("Error creating match embed:", embedError);
      await interaction.editReply(
        "Erreur lors de la création de l'affichage du match."
      );
      return;
    }

    // Create select menu for team selection using utility function
    const menuOptions = createTeamMenuOptions(filteredTeams);

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("team_select")
      .setPlaceholder("Choisir une équipe")
      .addOptions(menuOptions);

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu
    );

    await interaction.editReply({ embeds: [embed], components: [row] });
  } catch (error) {
    logger.error("Error in nextmatch command:", error);
    handleInteractionError(error, "nextmatch command");

    // Check if interaction is still valid and handle accordingly
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content:
            "Une erreur est survenue lors de la récupération du prochain match.",
          ephemeral: true,
        });
      } else if (interaction.deferred) {
        await interaction.editReply(
          "Une erreur est survenue lors de la récupération du prochain match."
        );
      }
    } catch (replyError) {
      logger.error("Error sending error message:", replyError);
    }
  }
}
