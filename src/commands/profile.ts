import { SlashCommandBuilder } from "@discordjs/builders";
import { EmbedBuilder, User } from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { TitleManager } from "../utils/titleManager";

export const data = new SlashCommandBuilder()
  .setName("profil")
  .setDescription("Afficher le profil de pari d'un utilisateur")
  .addUserOption((option: any) =>
    option
      .setName("utilisateur")
      .setDescription("Utilisateur à afficher")
      .setRequired(false)
  );

export async function execute(interaction: any) {
  try {
    const target: User =
      interaction.options.getUser("utilisateur") || interaction.user;
    const userId = target.id;
    await TitleManager.unlockWealthTitle(userId, interaction.client);

    const user = await prisma.user.upsert({
      where: { id: userId },
      update: {},
      create: { id: userId, username: target.username, points: 1000 },
    });

    const profile = await prisma.userProfile.upsert({
      where: { userId },
      update: {},
      create: { userId },
      include: { title: true },
    });

    const totalBets = await prisma.bet.count({
      where: { userId, status: { in: ["WON", "LOST"] } },
    });
    const wonBets = await prisma.bet.count({
      where: { userId, status: "WON" },
    });
    const lostBets = await prisma.bet.count({
      where: { userId, status: "LOST" },
    });
    const totalWageredAgg = await prisma.bet.aggregate({
      _sum: { amount: true },
      where: { userId },
    });
    const totalWonAgg = await prisma.bet.aggregate({
      _sum: { amount: true },
      where: { userId, status: "WON" },
    });
    const winRate = totalBets > 0 ? Math.round((wonBets / totalBets) * 100) : 0;

    const embed = new EmbedBuilder()
      .setColor(0x00bcd4)
      .setTitle(`Profil de ${target.username}`)
      .addFields(
        {
          name: "Titre",
          value: (profile as any).title?.name || "—",
          inline: true,
        },
        { name: "Solde", value: `${user.points} Perticoin`, inline: true },
        {
          name: "Bets",
          value: `${totalBets} (W:${wonBets} / L:${lostBets})`,
          inline: true,
        },
        { name: "Win rate", value: `${winRate}%`, inline: true },
        {
          name: "Total parié",
          value: `${totalWageredAgg._sum.amount || 0}`,
          inline: true,
        },
        {
          name: "Total misé gagnant",
          value: `${totalWonAgg._sum.amount || 0}`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  } catch (error) {
    logger.error("Error in profil command:", error);
    await interaction.reply({
      content: "Erreur lors de l'affichage du profil.",
    });
  }
}
