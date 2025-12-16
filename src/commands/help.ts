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
      .setTitle("Bot Karmine Corp - Aide")
      .setDescription(
        "Ce bot automatise les annonces de matchs Karmine Corp et propose un système de paris complet."
      )
      .setColor(0x0099ff)
      .addFields(
        {
          name: "🏆 Commandes de Matchs",
          value: `
**/nextmatch** - Prochain match à venir
**/standing** - Classements des tournois
          `,
          inline: false,
        },
        {
          name: "🎲 Commandes de Paris",
          value: `
**/bet** - Placer un pari simple sur un match
**/parlay** - Créer un pari combiné (accumulateur)
**/duel** - Défier un utilisateur 1v1 sur un match
**/mybets** - Consulter vos paris en cours
**/betstanding** - Classement global des parieurs
          `,
          inline: false,
        },
        {
          name: "👤 Commandes de Profil",
          value: `
**/profil** - Afficher votre profil de parieur
**/daily** - Récupérer votre récompense quotidienne
**/settitle** - Choisir votre titre de profil
**/season** - Informations de la saison en cours
          `,
          inline: false,
        },
        {
          name: "🏅 Commandes de Tournoi",
          value: `
**/tournament** - Gérer et consulter le tournoi du serveur
• Créer un tournoi
• Voir les statistiques
• Arrêter un tournoi
          `,
          inline: false,
        },
        {
          name: "💰 Commandes d'Économie",
          value: `
**/send** - Envoyer des Perticoins à un autre utilisateur
          `,
          inline: false,
        },
        {
          name: "⚙️ Commandes d'Administration",
          value: `
**/config** - Configuration complète du bot
• Canal d'annonce, rôles à mentionner
• Notifications avant-match, de score, de mise à jour et de stream Twitch
• Filtrage par équipes
          `,
          inline: false,
        },
        {
          name: "🎫 Commandes de Support",
          value: `
**/ticket** - Créer un ticket de support
**/mytickets** - Liste vos tickets de support
**/invitation** - Lien d'invitation du bot
          `,
          inline: false,
        },
        {
          name: "🔔 Messages automatiques",
          value: `
• Notifications quand un match est lancé
• Notifications de score
• Notifications de stream Twitch des joueurs
• Mises à jour du bot
          `,
          inline: false,
        }
      )
      .setTimestamp()
      .setFooter({ text: "Karmine Corp Match Bot" });

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
