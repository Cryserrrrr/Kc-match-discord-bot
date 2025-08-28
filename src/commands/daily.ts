import { SlashCommandBuilder, EmbedBuilder } from "discord.js";
import { PrismaClient } from "@prisma/client";
import { TitleManager } from "../utils/titleManager";

const prisma = new PrismaClient();

export const data = new SlashCommandBuilder()
  .setName("daily")
  .setDescription("Récupérer votre récompense quotidienne de Perticoin");

export async function execute(interaction: any) {
  try {
    const userId = interaction.user.id;
    const username = interaction.user.username;
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const existingReward = await prisma.dailyReward.findFirst({
      where: {
        userId: userId,
        claimedAt: {
          gte: today,
        },
      },
    });

    if (existingReward) {
      const nextDay = new Date(today);
      nextDay.setDate(nextDay.getDate() + 1);
      const timeUntilNext = nextDay.getTime() - Date.now();
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

    let user = await prisma.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      user = await prisma.user.create({
        data: {
          id: userId,
          username: username,
          points: 1000000,
        },
      });
    }

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const yesterdayReward = await prisma.dailyReward.findFirst({
      where: {
        userId: userId,
        claimedAt: {
          gte: yesterday,
          lt: today,
        },
      },
    });

    const baseReward = 200;
    const streakBonus = 50;
    let currentStreak = 0;

    if (yesterdayReward) {
      const recentRewards = await prisma.dailyReward.findMany({
        where: {
          userId: userId,
        },
        orderBy: {
          claimedAt: "desc",
        },
        take: 30,
      });

      let streak = 0;
      let currentDate = new Date(today);
      currentDate.setDate(currentDate.getDate() - 1);

      for (const reward of recentRewards) {
        const rewardDate = new Date(reward.claimedAt);
        rewardDate.setHours(0, 0, 0, 0);

        if (rewardDate.getTime() === currentDate.getTime()) {
          streak++;
          currentDate.setDate(currentDate.getDate() - 1);
        } else {
          break;
        }
      }

      currentStreak = Math.min(streak, 6);
    }

    const rewardAmount = baseReward + currentStreak * streakBonus;

    await prisma.dailyReward.create({
      data: {
        userId: userId,
        amount: rewardAmount,
      },
    });

    await prisma.user.update({
      where: { id: userId },
      data: { points: user.points + rewardAmount },
    });

    const titleUnlocked = await TitleManager.unlockFirstDailyTitle(
      userId,
      interaction.client
    );
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
          value: `${user.points + rewardAmount} Perticoins`,
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
