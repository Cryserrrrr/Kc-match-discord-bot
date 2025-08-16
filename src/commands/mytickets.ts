import {
  SlashCommandBuilder,
  CommandInteraction,
  EmbedBuilder,
} from "discord.js";
import { StatsManager } from "../utils/statsManager";
import { handleInteractionError } from "../utils/retryUtils";

export const data = new SlashCommandBuilder()
  .setName("mytickets")
  .setDescription("Voir vos tickets de support");

export async function execute(interaction: CommandInteraction) {
  const startTime = Date.now();

  try {
    if (!interaction.deferred && !interaction.replied) {
      await interaction.deferReply({ flags: 64 });
    }

    const userId = interaction.user.id;
    const username = interaction.user.username;

    const userTickets = await StatsManager.getUserTickets(userId);

    if (userTickets.length === 0) {
      await interaction.editReply({
        content: "📭 Vous n'avez pas encore créé de tickets de support.",
      });
      return;
    }

    const embeds = userTickets.map((ticket: any) => {
      const statusEmoji = {
        OPEN: "🟡",
        IN_PROGRESS: "🔵",
        RESOLVED: "🟢",
        CLOSED: "⚫",
      };

      const statusText = {
        OPEN: "Ouvert",
        IN_PROGRESS: "En cours",
        RESOLVED: "Résolu",
        CLOSED: "Fermé",
      };

      const embed = new EmbedBuilder()
        .setColor(
          ticket.status === "RESOLVED"
            ? "#00ff00"
            : ticket.status === "IN_PROGRESS"
            ? "#0099ff"
            : ticket.status === "CLOSED"
            ? "#666666"
            : "#ffaa00"
        )
        .setTitle(
          `${ticket.type === "BUG" ? "🐛" : "💡"} Ticket #${ticket.id.slice(
            -8
          )}`
        )
        .setDescription(ticket.description || "Aucune description")
        .addFields(
          {
            name: "Type",
            value: ticket.type === "BUG" ? "Bug" : "Amélioration",
            inline: true,
          },
          {
            name: "Statut",
            value: `${statusEmoji[ticket.status as keyof typeof statusEmoji]} ${
              statusText[ticket.status as keyof typeof statusText]
            }`,
            inline: true,
          },
          {
            name: "Créé le",
            value: `<t:${Math.floor(
              new Date(ticket.createdAt).getTime() / 1000
            )}:f>`,
            inline: true,
          },
          {
            name: "Réponse",
            value: ticket.answer || "Aucune réponse",
            inline: true,
          }
        )
        .setTimestamp(new Date(ticket.updatedAt))
        .setFooter({
          text: `Serveur: ${ticket.guild?.name || "Serveur inconnu"}`,
        });

      return embed;
    });

    const maxEmbedsPerMessage = 10;
    for (let i = 0; i < embeds.length; i += maxEmbedsPerMessage) {
      const batch = embeds.slice(i, i + maxEmbedsPerMessage);

      if (i === 0) {
        await interaction.editReply({
          content: `📋 **Vos tickets (${userTickets.length} total)**`,
          embeds: batch,
        });
      } else {
        await interaction.followUp({
          embeds: batch,
          flags: 64,
        });
      }
    }

    const effectiveGuildId = interaction.guildId || "DM";
    await StatsManager.recordCommandExecution({
      guildId: effectiveGuildId,
      commandName: "mytickets",
      userId,
      username,
      startTime,
      success: true,
    });
  } catch (error) {
    handleInteractionError(error, "mytickets command");

    const effectiveGuildId = interaction.guildId || "DM";
    await StatsManager.recordCommandExecution({
      guildId: effectiveGuildId,
      commandName: "mytickets",
      userId: interaction.user.id,
      username: interaction.user.username,
      startTime,
      success: false,
      errorMessage: error instanceof Error ? error.message : "Unknown error",
    });
  }
}
