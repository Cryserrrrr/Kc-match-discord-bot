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

// Cast: chaining after addStringOption narrows the builder type and hides addBooleanOption
export const data = (
  new SlashCommandBuilder()
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
    ) as any
).addBooleanOption((option: any) =>
  option
    .setName("notification")
    .setDescription(
      "MP quand le support répond (oui par défaut). Vos MP doivent être ouverts."
    )
    .setRequired(false)
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
    const notifyOnAnswer =
      (interaction as any).options?.getBoolean("notification") ?? true;

    const modal = new ModalBuilder()
      .setCustomId(`ticket_modal_${ticketType}_${notifyOnAnswer ? "dm" : "nodm"}`)
      .setTitle(
        `${ticketType === "BUG" ? "🐛" : "💡"} Nouveau ticket - ${ticketType === "BUG" ? "Bug" : "Amélioration"
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
    // Acknowledge within Discord's 3s window before any DB/DM work
    await interaction.deferReply({ flags: 64 });

    const [, , rawType, notifyFlag] = interaction.customId.split("_");
    const ticketType = rawType as "BUG" | "IMPROVEMENT";
    const notifyOnAnswer = notifyFlag === "dm";
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
      description,
      notifyOnAnswer
    );

    // Send DM to admin user about new ticket
    const adminUserIds = process.env.DISCORD_USER_ID?.split(",").map((id) => id.trim()).filter(Boolean) || [];
    if (adminUserIds.length > 0) {
      try {
        const client = interaction.client;
        const adminEmbed = new EmbedBuilder()
          .setColor(ticketType === "BUG" ? "#ff6b6b" : "#4ecdc4")
          .setTitle(`🎫 Nouveau ticket créé`)
          .setDescription(`Un nouveau ticket vient d'être créé`)
          .addFields(
            {
              name: "Type",
              value: ticketType === "BUG" ? "🐛 Bug" : "💡 Amélioration",
              inline: true,
            },
            {
              name: "ID du ticket",
              value: `#${ticket.id.slice(-8)}`,
              inline: true,
            },
            {
              name: "Utilisateur",
              value: `${username} (${userId})`,
              inline: true,
            },
            {
              name: "Description",
              value:
                description.length > 1024
                  ? description.substring(0, 1021) + "..."
                  : description,
            },
            {
              name: "Lien",
              value:
                "[Voir le ticket sur Discord.cryser.fr](https://discord.cryser.fr/)",
            }
          )
          .setTimestamp()
          .setFooter({ text: `Ticket créé par ${username}` });

        // Fire-and-forget: admin DMs must not delay the user's response
        void (async () => {
          for (const adminUserId of adminUserIds) {
            try {
              const adminUser = await client.users.fetch(adminUserId);
              await adminUser.send({ embeds: [adminEmbed] });
              logger.info(
                `Sent ticket notification to admin user ${adminUserId}`
              );
            } catch (adminDmError) {
              logger.error(
                `Could not send DM to admin user ${adminUserId}:`,
                adminDmError
              );
            }
          }
        })();
      } catch (error) {
        logger.error("Error sending ticket notifications to admins:", error);
      }
    }

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
          name: "Notification",
          value: notifyOnAnswer
            ? "🔔 Vous recevrez un message privé dès que le support répondra.\n⚠️ Si vos messages privés sont fermés, le bot ne pourra pas vous l'envoyer et la notification sera annulée."
            : "🔕 Pas de message privé à la réponse (voir `/mytickets`)",
        },
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

      await interaction.editReply({
        content:
          "✅ Votre ticket a été créé avec succès ! Une confirmation vous a été envoyée en message privé.",
      });
    } catch (dmError) {
      logger.warn(`Could not send DM to user ${userId}:`, dmError);

      await interaction.editReply({
        content: notifyOnAnswer
          ? "⚠️ Vos messages privés semblent fermés : ouvrez-les pour recevoir la réponse du support, sinon la notification sera annulée."
          : undefined,
        embeds: [embed],
      });
    }
  } catch (error) {
    logger.error("Error handling ticket modal submit:", error);
    const errorResponse = {
      content:
        "❌ Une erreur s'est produite lors de la création du ticket. Veuillez réessayer.",
    };
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorResponse);
      } else {
        await interaction.reply({ ...errorResponse, flags: 64 });
      }
    } catch {}
  }
}
