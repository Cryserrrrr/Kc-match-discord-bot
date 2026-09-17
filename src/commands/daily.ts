import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { prisma } from "../db";
import { TitleManager } from "../utils/titleManager";
import { getDayKey, startOfDayInTimezone } from "../utils/dateUtils";

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Récupérer votre récompense quotidienne de Perticoin");

const BASE_REWARD = 200;
const STREAK_BONUS = 50;
const MAX_STREAK_BONUS_DAYS = 6;

export async function execute(interaction: any) {
  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    // Daily reset happens at midnight Europe/Paris, whatever the server timezone
    const today = startOfDayInTimezone(new Date());

    const outcome = await prisma.$transaction(async (tx) => {
      // Serialize concurrent /daily calls for the same user
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`daily:${userId}`}))`;

      const existingReward = await tx.dailyReward.findFirst({
        where: { userId, claimedAt: { gte: today } },
      });
      if (existingReward) {
        return { claimed: false as const };
      }

      await tx.user.upsert({
        where: { id: userId },
        update: {},
        create: { id: userId, username, points: 1000 },
      });

      const recentRewards = await tx.dailyReward.findMany({
        where: { userId },
        orderBy: { claimedAt: "desc" },
        take: 30,
      });

      // Count consecutive previous days (Paris calendar) with a claim
      let streak = 0;
      let expected = startOfDayInTimezone(
        new Date(today.getTime() - 12 * 60 * 60 * 1000)
      );
      const claimedDays = new Set(
        recentRewards.map((r) => getDayKey(r.claimedAt))
      );
      while (claimedDays.has(getDayKey(expected))) {
        streak++;
        expected = startOfDayInTimezone(
          new Date(expected.getTime() - 12 * 60 * 60 * 1000)
        );
      }
      const currentStreak = Math.min(streak, MAX_STREAK_BONUS_DAYS);
      const rewardAmount = BASE_REWARD + currentStreak * STREAK_BONUS;

      await tx.dailyReward.create({
        data: { userId, amount: rewardAmount },
      });
      const user = await tx.user.update({
        where: { id: userId },
        data: { points: { increment: rewardAmount } },
      });

      return {
        claimed: true as const,
        rewardAmount,
        currentStreak,
        newBalance: user.points,
      };
    });

    if (!outcome.claimed) {
      const nextDay = startOfDayInTimezone(
        new Date(today.getTime() + 36 * 60 * 60 * 1000)
      );
      const timeUntilNext = Math.max(0, nextDay.getTime() - Date.now());
      const hours = Math.floor(timeUntilNext / (1000 * 60 * 60));
      const minutes = Math.floor(
        (timeUntilNext % (1000 * 60 * 60)) / (1000 * 60)
      );

      const embed = new EmbedBuilder()
        .setColor(0xff6b6b)
        .setTitle("Récompense Quotidienne Déjà Récupérée")
        .setDescription(
          `Vous avez déjà récupéré votre récompense quotidienne aujourd'hui !`
        )
        .addFields({
          name: "Prochaine Récompense Disponible",
          value: `Dans ${hours}h ${minutes}m`,
          inline: true,
        })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed], ephemeral: true });
      return;
    }

    const { rewardAmount, currentStreak, newBalance } = outcome;

    let titleUnlocked = false;
    try {
      titleUnlocked = await TitleManager.unlockFirstDailyTitle(
        userId,
        interaction.client
      );
    } catch (error) {
      console.error("Error unlocking daily title:", error);
    }
    try {
      if (currentStreak + 1 >= 7) {
        await TitleManager.unlockDailyMaxStreak(userId, interaction.client);
      }
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("Récompense Quotidienne Récupérée !")
      .setDescription(`Vous avez reçu **${rewardAmount} Perticoins** !`)
      .addFields(
        {
          name: "Série Actuelle",
          value: `${currentStreak + 1} jours`,
          inline: true,
        },
        {
          name: "Nouveau Solde",
          value: `${newBalance} Perticoins`,
          inline: true,
        }
      )
      .setTimestamp();

    if (titleUnlocked) {
      embed.addFields({
        name: "🎖️ Nouveau Titre Débloqué !",
        value: "Vous avez débloqué le titre **Débutant** !",
        inline: false,
      });
    }

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    console.error("Error in daily command:", error);
    const errorEmbed = new EmbedBuilder()
      .setColor(0xff6b6b)
      .setTitle("Erreur")
      .setDescription(
        "Une erreur s'est produite lors de la récupération de votre récompense quotidienne. Veuillez réessayer plus tard."
      )
      .setTimestamp();

    try {
      await interaction.editReply({ embeds: [errorEmbed], ephemeral: true });
    } catch (replyError) {
      console.error("Error sending error message:", replyError);
    }
  }
}
