import {
  SlashCommandBuilder,
  CommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("filterteams")
  .setDescription(
    "Choisir quelles équipes de Karmine Corp doivent être annoncées"
  )
  .addStringOption((option: any) =>
    option
      .setName("teams")
      .setDescription(
        "Sélectionner les équipes à annoncer (vide = toutes les équipes)"
      )
      .setRequired(false)
      .addChoices(
        { name: "KC (LEC)", value: "134078" },
        { name: "KCB (LFL)", value: "128268" },
        { name: "KCBS (LFL2)", value: "136080" },
        { name: "KC Valorant", value: "130922" },
        { name: "KCGC Valorant", value: "132777" },
        { name: "KCBS Valorant", value: "136165" },
        { name: "KC Rocket League", value: "129570" }
      )
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: CommandInteraction) {
  try {
    const selectedTeam = (interaction as any).options.getString("teams");
    const guildId = interaction.guildId!;

    // Get current guild settings
    let guildSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });

    if (!guildSettings) {
      await interaction.reply({
        content:
          "❌ Vous devez d'abord configurer un salon d'annonce avec `/setchannel` !",
        flags: 64,
      });
      return;
    }

    // Use any type to avoid TypeScript errors until Prisma types are updated
    let currentFilteredTeams = (guildSettings as any).filteredTeams || [];
    let newFilteredTeams: string[] = [];

    if (selectedTeam) {
      // If a team is selected, toggle it in the list
      if (currentFilteredTeams.includes(selectedTeam)) {
        // Remove team from filter
        newFilteredTeams = currentFilteredTeams.filter(
          (id: string) => id !== selectedTeam
        );
      } else {
        // Add team to filter
        newFilteredTeams = [...currentFilteredTeams, selectedTeam];
      }
    } else {
      // If no team selected, clear all filters (show all teams)
      newFilteredTeams = [];
    }

    // Update guild settings
    await prisma.guildSettings.update({
      where: { guildId },
      data: {
        filteredTeams: newFilteredTeams,
      } as any,
    });

    // Create response message
    const teamNames: { [key: string]: string } = {
      "134078": "KC (LEC)",
      "128268": "KCB (LFL)",
      "136080": "KCBS (LFL2)",
      "130922": "KC Valorant",
      "132777": "KCGC Valorant",
      "136165": "KCBS Valorant",
      "129570": "KC Rocket League",
    };

    let responseMessage: string;

    if (newFilteredTeams.length === 0) {
      responseMessage =
        "✅ **Filtre mis à jour :** Toutes les équipes de Karmine Corp seront annoncées.";
    } else {
      const selectedTeamNames = newFilteredTeams.map(
        (id) => teamNames[id] || id
      );
      responseMessage = `✅ **Filtre mis à jour :** Seules les équipes suivantes seront annoncées :\n${selectedTeamNames
        .map((name) => `• ${name}`)
        .join("\n")}`;
    }

    await interaction.reply({
      content: responseMessage,
      flags: 64,
    });

    logger.info(
      `Guild ${guildId} updated team filter: ${
        newFilteredTeams.join(", ") || "all teams"
      }`
    );
  } catch (error) {
    logger.error("Error in filterTeams command:", error);
    await interaction.reply({
      content:
        "Une erreur s'est produite lors de la mise à jour du filtre d'équipes.",
      flags: 64,
    });
  }
}
