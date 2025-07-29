import {
  SlashCommandBuilder,
  CommandInteraction,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("setchannel")
  .setDescription("Définir le salon Discord pour les annonces de matchs")
  .addChannelOption((option: any) =>
    option
      .setName("channel")
      .setDescription("Le salon où les annonces de matchs seront envoyées")
      .addChannelTypes(ChannelType.GuildText)
      .setRequired(true)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: CommandInteraction) {
  try {
    const channel = (interaction as any).options.getChannel("channel");

    if (!channel) {
      await interaction.reply({
        content: "Veuillez sélectionner un salon texte valide !",
        flags: 64,
      });
      return;
    }

    const guildId = interaction.guildId!;

    // Upsert guild settings
    await prisma.guildSettings.upsert({
      where: { guildId },
      update: {
        channelId: channel.id,
        customMessage: "@everyone Match du jour !",
      },
      create: {
        guildId,
        channelId: channel.id,
        customMessage: "@everyone Match du jour !",
      },
    });

    await interaction.reply({
      content: `✅ Salon d'annonce défini sur <#${channel.id}> ! Les notifications de matchs seront envoyées ici.`,
      flags: 64,
    });

    logger.info(`Guild ${guildId} set announcement channel to ${channel.id}`);
  } catch (error) {
    logger.error("Error in setchannel command:", error);
    await interaction.reply({
      content:
        "Une erreur s'est produite lors de la définition du salon d'annonce.",
      flags: 64,
    });
  }
}
