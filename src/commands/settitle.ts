import { SlashCommandBuilder } from "@discordjs/builders";
import {
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ActionRowBuilder,
} from "discord.js";
import { prisma } from "../db";
import { logger } from "../utils/logger";
import { TitleManager } from "../utils/titleManager";

export const data = new SlashCommandBuilder()
  .setName("settitle")
  .setDescription("Choisir votre titre de profil");

export async function execute(interaction: any) {
  try {
    const userId = interaction.user.id;
    const unlockedTitles = await TitleManager.getUnlockedTitles(userId);
    await TitleManager.unlockBetterMetaTitle(userId, interaction.client);

    if (unlockedTitles.length === 0) {
      await interaction.editReply({
        content:
          "Vous n'avez débloqué aucun titre pour le moment. Utilisez les commandes du bot pour débloquer des titres !",
        ephemeral: true,
      });
      return;
    }

    const titles = await prisma.title.findMany({
      where: {
        name: {
          in: unlockedTitles,
        },
      },
      orderBy: { name: "asc" },
    });

    if (titles.length === 0) {
      await interaction.editReply({
        content: "Aucun titre disponible pour le moment.",
        ephemeral: true,
      });
      return;
    }

    const selectMenu = new StringSelectMenuBuilder()
      .setCustomId("title_selection")
      .setPlaceholder("Sélectionnez votre titre")
      .addOptions(
        titles.map((title) =>
          new StringSelectMenuOptionBuilder()
            .setLabel(title.name)
            .setValue(title.id)
            .setDescription(
              title.icon ? `${title.icon} ${title.name}` : title.name
            )
        )
      );

    const row = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
      selectMenu
    );

    const embed = new EmbedBuilder()
      .setColor(0x00bcd4)
      .setTitle("🎖️ Sélection de titre")
      .setDescription(
        `Vous avez débloqué ${titles.length} titre(s). Choisissez celui que vous souhaitez afficher sur votre profil.`
      )
      .setFooter({
        text: "Utilisez les commandes du bot pour débloquer plus de titres",
      });

    await interaction.editReply({
      embeds: [embed],
      components: [row],
      ephemeral: true,
    });
  } catch (error) {
    logger.error("Error in settitle command:", error);
    await interaction.editReply({
      content: "Erreur lors de la sélection du titre.",
      ephemeral: true,
    });
  }
}
