import { SlashCommandBuilder } from "@discordjs/builders";
import { EmbedBuilder, User, GuildMember } from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { ensureUser } from "../utils/bettingUtils";
import { TitleManager } from "../utils/titleManager";

export const data = new SlashCommandBuilder()
  .setName("send")
  .setDescription("Envoyer des Perticoins à un autre utilisateur")
  .addUserOption((option: any) =>
    option
      .setName("utilisateur")
      .setDescription("Utilisateur à qui envoyer des Perticoins")
      .setRequired(true)
  )
  .addIntegerOption((option: any) =>
    option
      .setName("montant")
      .setDescription("Montant à envoyer (minimum 1)")
      .setRequired(true)
  );

export async function execute(interaction: any) {
  try {
    const senderId: string = interaction.user.id;
    const senderUsername: string = interaction.user.username;
    const target: User = interaction.options.getUser("utilisateur", true);
    const amount: number = interaction.options.getInteger("montant", true);

    if (amount < 1) {
      await interaction.editReply({
        content: "Le montant doit être au moins 1.",
        ephemeral: true,
      });
      return;
    }

    if (target.id === senderId) {
      await interaction.editReply({
        content: "Vous ne pouvez pas vous envoyer des Perticoins.",
        ephemeral: true,
      });
      return;
    }

    const sender = await ensureUser(senderId, senderUsername);
    const receiver = await ensureUser(target.id, target.username);

    if (sender.points < amount) {
      await interaction.editReply({
        content: `Solde insuffisant. Votre solde: ${sender.points} Perticoins.`,
        ephemeral: true,
      });
      return;
    }

    const result = await prisma.$transaction(async (tx) => {
      const dec = await tx.user.updateMany({
        where: { id: sender.id, points: { gte: amount } },
        data: { points: { decrement: amount } },
      });

      if (dec.count !== 1) {
        return null;
      }

      const inc = await tx.user.update({
        where: { id: receiver.id },
        data: { points: { increment: amount } },
      });

      const updatedSender = await tx.user.findUnique({
        where: { id: sender.id },
      });

      return { inc, updatedSender };
    });

    if (!result) {
      await interaction.editReply({
        content: "Transaction impossible. Solde insuffisant.",
        ephemeral: true,
      });
      return;
    }

    let senderDisplay = interaction.user.username;
    try {
      senderDisplay =
        (interaction.member as GuildMember)?.displayName || senderDisplay;
    } catch {}

    let recipientDisplay = target.username;
    try {
      const gm = await interaction.guild?.members.fetch(target.id);
      recipientDisplay = gm?.displayName || recipientDisplay;
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("Transfert effectué ✅")
      .setDescription(
        `${senderDisplay} a envoyé ${amount} Perticoins à ${recipientDisplay}`
      )
      .setTimestamp();

    await interaction.editReply({
      content:
        "Transfert envoyé. Solde restant: " + result.updatedSender?.points,
      embeds: [],
    });
    await interaction.followUp({ embeds: [embed] });

    try {
      await TitleManager.unlockTransferAmountTitle(
        senderId,
        amount,
        interaction.client
      );
    } catch {}
  } catch (error) {
    logger.error("Error in send command:", error);
    try {
      await interaction.editReply({
        content: "Erreur lors du transfert. Veuillez réessayer plus tard.",
      });
    } catch {}
  }
}
