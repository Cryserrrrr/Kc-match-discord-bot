import {
  SlashCommandBuilder,
  CommandInteraction,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { createMatchEmbed } from "../utils/embedBuilder";
import { getTeamDisplayName } from "../utils/teamMapper";

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
        { name: "KC (LEC)", value: "134078" },
        { name: "KCB (LFL)", value: "128268" },
        { name: "KCBS (LFL2)", value: "136080" },
        { name: "KC Valorant", value: "130922" },
        { name: "KCGC Valorant", value: "132777" },
        { name: "KCBS Valorant", value: "136165" },
        { name: "KC Rocket League", value: "129570" }
      )
  );

export async function execute(interaction: CommandInteraction) {
  try {
    // Defer the reply immediately to prevent timeout
    await interaction.deferReply();

    const selectedTeam =
      (interaction as any).options?.getString("team") || "all";

    // Get guild settings to check team filters
    const guildId = interaction.guildId!;
    const guildSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });

    const filteredTeams = (guildSettings as any)?.filteredTeams || [];
    logger.info(`Filtered teams: ${filteredTeams}`);

    // Build the where clause based on team selection
    const whereClause: any = {
      beginAt: {
        gte: new Date(),
      },
      kcId: { in: filteredTeams },
    };

    // If a specific team is selected, filter by that team
    if (selectedTeam !== "all") {
      whereClause.kcId = selectedTeam;
    } else if (filteredTeams.length > 0) {
      // If no specific team is selected but there are filtered teams, use the filter
      whereClause.kcId = {
        in: filteredTeams,
      };
    }

    // Find the next match
    const nextMatch = await prisma.match.findFirst({
      where: whereClause,
      orderBy: {
        beginAt: "asc",
      },
    });

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

    // Create embed using the utility function
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

    // Create select menu for team selection
    const menuOptions = [
      new StringSelectMenuOptionBuilder()
        .setLabel("Toutes les équipes")
        .setDescription(
          filteredTeams.length > 0
            ? `Voir le prochain match des équipes filtrées (${filteredTeams.length} équipe(s))`
            : "Voir le prochain match de toutes les équipes"
        )
        .setValue("all"),
    ];

    // Add team options, only including filtered teams if filters are set
    const allTeams = [
      {
        id: "134078",
        name: "KC (LEC)",
        desc: "Équipe principale League of Legends",
      },
      {
        id: "128268",
        name: "KCB (LFL)",
        desc: "Équipe académique League of Legends",
      },
      {
        id: "136080",
        name: "KCBS (LFL2)",
        desc: "Équipe LFL2 League of Legends",
      },
      { id: "130922", name: "KC Valorant", desc: "Équipe principale Valorant" },
      { id: "132777", name: "KCGC Valorant", desc: "Équipe féminine Valorant" },
      { id: "136165", name: "KCBS Valorant", desc: "Équipe KCBS Valorant" },
      { id: "129570", name: "KC Rocket League", desc: "Équipe Rocket League" },
    ];

    allTeams.forEach((team) => {
      // Only add team if no filters are set, or if the team is in the filtered list
      if (filteredTeams.length === 0 || filteredTeams.includes(team.id)) {
        menuOptions.push(
          new StringSelectMenuOptionBuilder()
            .setLabel(team.name)
            .setDescription(team.desc)
            .setValue(team.id)
        );
      }
    });

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

    // Check if interaction is still valid and handle accordingly
    try {
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply(
          "Une erreur est survenue lors de la récupération du prochain match."
        );
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
