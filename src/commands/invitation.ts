import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("invitation")
  .setDescription(
    "Obtenir le lien d'invitation pour ajouter le bot à votre serveur"
  );

export async function execute(interaction: CommandInteraction) {
  try {
    const embed = new EmbedBuilder()
      .setTitle("Invitation du Bot")
      .setColor(0x0099ff)
      .addFields({
        name: "Cliquez sur le lien ci-dessous pour ajouter le bot Karmine Corp à votre serveur Discord ",
        value: "[Lien d'invitation](https://discord.cryser.fr/invite)",
        inline: false,
      })
      .setFooter({
        text: "Bot Karmine Corp - Développé avec ❤️ par Cryser",
      })
      .setTimestamp();

    if (interaction.deferred) {
      await interaction.editReply({ embeds: [embed] });
    } else {
      await interaction.reply({ embeds: [embed] });
    }
  } catch (error) {
    logger.error("Error executing invitation command:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content:
          "❌ Une erreur s'est produite lors de l'affichage du lien d'invitation.",
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content:
          "❌ Une erreur s'est produite lors de l'affichage du lien d'invitation.",
        ephemeral: true,
      });
    }
  }
}
