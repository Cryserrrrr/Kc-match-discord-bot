import {
  SlashCommandBuilder,
  CommandInteraction,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  EmbedBuilder,
  ActionRowBuilder,
} from "discord.js";
import { StatsManager } from "../utils/statsManager";
import { logger } from "../utils/logger";
import { handleInteractionError } from "../utils/retryUtils";

export const data = new SlashCommandBuilder()
  .setName("ticket")
  .setDescription("Créer un ticket de support (bug ou amélioration)")
  .addStringOption((option: any) =>
    option
      .setName("type")
      .setDescription("Type de ticket")
      .setRequired(true)
      .addChoices(
        { name: "🐛 Bug", value: "BUG" },
        { name: "💡 Amélioration", value: "IMPROVEMENT" }
      )
  );

export async function execute(interaction: CommandInteraction) {
  const startTime = Date.now();

  try {
    const ticketType = (interaction as any).options?.getString("type") as
      | "BUG"
      | "IMPROVEMENT";
    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const effectiveGuildId = guildId || "DM";

    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${ticketType}`)
      .setTitle(
        `${ticketType === "BUG" ? "🐛" : "💡"} Nouveau ticket - ${
          ticketType === "BUG" ? "Bug" : "Amélioration"
        }`
      );

    const descriptionInput = new TextInputBuilder()
      .setCustomId("ticket_description")
      .setLabel("Description")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("Décrivez le problème ou l'amélioration en détail...")
      .setRequired(true)
      .setMaxLength(1000);

    const firstActionRow =
      new ActionRowBuilder<TextInputBuilder>().addComponents(descriptionInput);
    modal.addComponents(firstActionRow);

    await interaction.showModal(modal);

    try {
      await StatsManager.recordCommandExecution({
        guildId: effectiveGuildId,
        commandName: "ticket",
        userId,
        username,
        startTime,
        success: true,
      });
    } catch (statsError) {
      logger.error("Error recording ticket command stats:", statsError);
    }
  } catch (error) {
    handleInteractionError(error, "ticket command");

    try {
      if (interaction.guildId) {
        await StatsManager.recordCommandExecution({
          guildId: interaction.guildId,
          commandName: "ticket",
          userId: interaction.user.id,
          username: interaction.user.username,
          startTime,
          success: false,
          errorMessage:
            error instanceof Error ? error.message : "Unknown error",
        });
      }
    } catch (statsError) {
      logger.error("Error recording ticket command error stats:", statsError);
    }
  }
}

export async function handleTicketModalSubmit(interaction: any) {
  try {
    const ticketType = interaction.customId.split("_")[2] as
      | "BUG"
      | "IMPROVEMENT";
    const description =
      interaction.fields.getTextInputValue("ticket_description");

    const guildId = interaction.guildId;
    const userId = interaction.user.id;
    const username = interaction.user.username;

    const effectiveGuildId = guildId || "DM";

    const ticket = await StatsManager.createTicket(
      effectiveGuildId,
      userId,
      username,
      ticketType,
      description
    );

    const embed = new EmbedBuilder()
      .setColor(ticketType === "BUG" ? "#ff6b6b" : "#4ecdc4")
      .setTitle(`${ticketType === "BUG" ? "🐛" : "💡"} Ticket créé avec succès`)
      .setDescription(
        `Votre ticket a été enregistré et sera traité par l'équipe.`
      )
      .addFields(
        {
          name: "Type",
          value: ticketType === "BUG" ? "Bug" : "Amélioration",
          inline: true,
        },
        {
          name: "ID du ticket",
          value: `#${ticket.id.slice(-8)}`,
          inline: true,
        },
        { name: "Statut", value: "Ouvert", inline: true },
        {
          name: "Description",
          value:
            description.length > 1024
              ? description.substring(0, 1021) + "..."
              : description,
        }
      )
      .setTimestamp()
      .setFooter({ text: `Créé par ${username}` });

    try {
      await interaction.user.send({
        embeds: [embed],
      });

      await interaction.reply({
        content:
          "✅ Votre ticket a été créé avec succès ! Une confirmation vous a été envoyée en message privé.",
        flags: 64,
      });
    } catch (dmError) {
      logger.warn(`Could not send DM to user ${userId}:`, dmError);

      await interaction.reply({
        embeds: [embed],
        flags: 64,
      });
    }
  } catch (error) {
    logger.error("Error handling ticket modal submit:", error);
    await interaction.reply({
      content:
        "❌ Une erreur s'est produite lors de la création du ticket. Veuillez réessayer.",
      flags: 64,
    });
  }
}
