import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("Affiche l'aide et les commandes disponibles du bot");

export async function execute(interaction: CommandInteraction) {
  try {
    const embed = new EmbedBuilder()
      .setTitle("🤖 Bot Karmine Corp - Aide")
      .setDescription(
        "Ce bot automatise les annonces de matchs Karmine Corp sur Discord."
      )
      .setColor(0x0099ff)
      .addFields(
        {
          name: "📋 Commandes disponibles",
          value: `
** /config** - Configuration complète du bot
• Canal d'annonce, rôles à mentionner
• Notifications avant-match, de score et de mise à jour
• Filtrage par équipes

** /standing** - Classements des tournois

** /nextmatch** - Prochain match

** /ticket** - Créer un ticket de support

** /mytickets** - Liste vos tickets de support
          `,
          inline: false,
        },
        {
          name: "🔔 Messages automatiques",
          value: `
- **Notifications quand un match est lancé**
- **Notifications de score**
- **Mises à jour du bot**
          `,
          inline: false,
        }
      )
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
    logger.error("Error executing help command:", error);

    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({
        content: "❌ Une erreur s'est produite lors de l'affichage de l'aide.",
        ephemeral: true,
      });
    } else {
      await interaction.followUp({
        content: "❌ Une erreur s'est produite lors de l'affichage de l'aide.",
        ephemeral: true,
      });
    }
  }
}
