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
**⚙️ /config** - Configuration complète du bot
• Canal d'annonce, rôles à mentionner
• Notifications avant-match, de score et de mise à jour
• Filtrage par équipes

**🎫 /ticket** - Créer un ticket de support
• Pour signaler un problème ou demander de l'aide

**🏆 /standing** - Classements des tournois
• Affiche les classements actuels des équipes KC

**📅 /nextmatch** - Prochain match
• Affiche le prochain match programmé

**🎫 /mytickets** - Mes tickets
• Liste vos tickets de support
          `,
          inline: false,
        },
        {
          name: "🔔 Messages automatiques",
          value: `
**🚨 Notifications de dernière minute**
• Envoyées quand un match commence
• Mention des rôles configurés
• Informations du match (équipes, tournoi, heure)

**🏆 Notifications de score**
• Envoyées quand un match se termine
• Résultat final avec score
• Résumé du match

**📢 Mises à jour du bot**
• Changements de fonctionnalités
• Corrections de bugs
• Nouvelles équipes supportées
          `,
          inline: false,
        }
      )
      .setFooter({
        text: "Bot Karmine Corp - Développé avec ❤️ par Cryser",
      })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    logger.error("Error executing help command:", error);
    await interaction.reply({
      content: "❌ Une erreur s'est produite lors de l'affichage de l'aide.",
      ephemeral: true,
    });
  }
}
