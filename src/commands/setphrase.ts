import {
  SlashCommandBuilder,
  CommandInteraction,
  PermissionFlagsBits,
} from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("setphrase")
  .setDescription("Personnaliser le message d'annonce de match")
  .addStringOption((option: any) =>
    option
      .setName("message")
      .setDescription(
        "Message d'annonce personnalisé (ex: '@everyone Match du jour')"
      )
      .setRequired(true)
      .setMaxLength(500)
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);

export async function execute(interaction: CommandInteraction) {
  try {
    const customMessage = (interaction as any).options.getString(
      "message",
      true
    );
    const guildId = interaction.guildId!;

    const existingSettings = await prisma.guildSettings.findUnique({
      where: { guildId },
    });

    if (!existingSettings) {
      await interaction.reply({
        content:
          "❌ Veuillez d'abord définir un salon d'annonce avec `/config` !",
        flags: 64,
      });
      return;
    }

    await prisma.guildSettings.update({
      where: { guildId },
      data: { customMessage },
    });

    await interaction.reply({
      content: `✅ Message personnalisé mis à jour !\n\n**Aperçu :** ${customMessage}`,
      flags: 64,
    });

    logger.info(`Guild ${guildId} updated custom message: ${customMessage}`);
  } catch (error) {
    logger.error("Error in setphrase command:", error);
    await interaction.reply({
      content:
        "Une erreur s'est produite lors de la mise à jour du message personnalisé.",
      flags: 64,
    });
  }
}
