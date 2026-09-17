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

function truncate(text: string, max: number): string {
  return text.length > max ? text.substring(0, max - 3) + "..." : text;
}

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
        .setDescription(truncate(ticket.description || "Aucune description", 1000))
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
            value: truncate(ticket.answer || "Aucune réponse", 1024),
            inline: true,
          }
        )
        .setTimestamp(new Date(ticket.updatedAt))
        .setFooter({
          text: `Serveur: ${ticket.guild?.name || "Serveur inconnu"}`,
        });

      return embed;
    });

    // Discord limits: 10 embeds and 6000 characters per message
    const batches: EmbedBuilder[][] = [];
    let current: EmbedBuilder[] = [];
    let currentSize = 0;
    for (const embed of embeds) {
      const size = JSON.stringify(embed.toJSON()).length;
      if (current.length > 0 && (current.length >= 10 || currentSize + size > 5000)) {
        batches.push(current);
        current = [];
        currentSize = 0;
      }
      current.push(embed);
      currentSize += size;
    }
    if (current.length > 0) batches.push(current);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];

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
    try {
      await interaction.editReply({
        content:
          "❌ Une erreur s'est produite lors du chargement de vos tickets.",
        embeds: [],
      });
    } catch {}

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
