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

    // Build the where clause based on team selection
    const whereClause: any = {
      beginAt: {
        gte: new Date(),
      },
    };

    // If a specific team is selected, filter by that team
    if (selectedTeam !== "all") {
      whereClause.kcId = selectedTeam;
    }

    // Find the next unannounced match
    const nextMatch = await prisma.match.findFirst({
      where: whereClause,
      orderBy: {
        beginAt: "asc",
      },
    });

    if (!nextMatch) {
      const teamText =
        selectedTeam === "all"
          ? "Karmine Corp"
          : getTeamDisplayName(selectedTeam);
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
    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("team_select")
      .setPlaceholder("Choisir une équipe")
      .addOptions(
        new StringSelectMenuOptionBuilder()
          .setLabel("Toutes les équipes")
          .setDescription("Voir le prochain match de toutes les équipes")
          .setValue("all"),
        new StringSelectMenuOptionBuilder()
          .setLabel("KC (LEC)")
          .setDescription("Équipe principale League of Legends")
          .setValue("134078"),
        new StringSelectMenuOptionBuilder()
          .setLabel("KCB (LFL)")
          .setDescription("Équipe académique League of Legends")
          .setValue("128268"),
        new StringSelectMenuOptionBuilder()
          .setLabel("KCBS (LFL2)")
          .setDescription("Équipe LFL2 League of Legends")
          .setValue("136080"),
        new StringSelectMenuOptionBuilder()
          .setLabel("KC Valorant")
          .setDescription("Équipe principale Valorant")
          .setValue("130922"),
        new StringSelectMenuOptionBuilder()
          .setLabel("KCGC Valorant")
          .setDescription("Équipe féminine Valorant")
          .setValue("132777"),
        new StringSelectMenuOptionBuilder()
          .setLabel("KCBS Valorant")
          .setDescription("Équipe KCBS Valorant")
          .setValue("136165"),
        new StringSelectMenuOptionBuilder()
          .setLabel("KC Rocket League")
          .setDescription("Équipe Rocket League")
          .setValue("129570")
      );

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
