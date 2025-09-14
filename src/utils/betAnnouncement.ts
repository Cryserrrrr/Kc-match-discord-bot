import { EmbedBuilder } from "discord.js";
import { prisma } from "../index";
import { logger } from "./logger";

export async function sendBetAnnouncement(
  interaction: any,
  betData: {
    type: "TEAM" | "SCORE";
    selection: string;
    amount: number;
    odds: number;
    matchId: string;
  }
) {
  try {
    const match = await prisma.match.findUnique({
      where: { id: betData.matchId },
    });

    if (!match) {
      logger.error(`Match not found for bet announcement: ${betData.matchId}`);
      return;
    }

    const potentialWin = Math.floor(betData.amount * betData.odds);
    const userMention = `<@${interaction.user.id}>`;

    let selectionText = "";
    if (betData.type === "TEAM") {
      selectionText = `**${betData.selection}**`;
    } else {
      selectionText = `le score **${betData.selection}**`;
    }

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle("🎯 Nouveau Pari Placé !")
      .setDescription(
        `${userMention} a placé un pari sur ${selectionText} pour le match ${match.kcTeam} vs ${match.opponent}`
      )
      .addFields(
        {
          name: "Mise",
          value: `${betData.amount} Perticoin`,
          inline: true,
        },
        {
          name: "Cote",
          value: `${betData.odds}x`,
          inline: true,
        },
        {
          name: "Gain Potentiel",
          value: `${potentialWin} Perticoin`,
          inline: true,
        }
      )
      .setTimestamp();

    await interaction.followUp({
      embeds: [embed],
      ephemeral: false,
    });

    logger.info(
      `Bet announcement sent for user ${interaction.user.id} on match ${betData.matchId}`
    );
  } catch (error) {
    logger.error("Error sending bet announcement:", error);
  }
}

export async function sendParlayAnnouncement(
  interaction: any,
  parlayData: {
    amount: number;
    totalOdds: number;
    legs: Array<{
      type: "TEAM" | "SCORE";
      selection: string;
      matchId: string;
      odds: number;
    }>;
  }
) {
  try {
    const potentialWin = Math.floor(parlayData.amount * parlayData.totalOdds);
    const userMention = `<@${interaction.user.id}>`;

    const embed = new EmbedBuilder()
      .setColor(0xff6b35)
      .setTitle("🎲 Nouveau Parlay Placé !")
      .setDescription(
        `${userMention} a créé un parlay avec ${parlayData.legs.length} sélections`
      )
      .addFields(
        {
          name: "Mise Totale",
          value: `${parlayData.amount} Perticoin`,
          inline: true,
        },
        {
          name: "Cotes Totales",
          value: `${parlayData.totalOdds.toFixed(2)}x`,
          inline: true,
        },
        {
          name: "Gain Potentiel",
          value: `${potentialWin} Perticoin`,
          inline: true,
        }
      )
      .setTimestamp();

    for (let i = 0; i < parlayData.legs.length; i++) {
      const leg = parlayData.legs[i];
      const match = await prisma.match.findUnique({
        where: { id: leg.matchId },
      });

      if (match) {
        let selectionText = "";
        if (leg.type === "TEAM") {
          selectionText = `**${leg.selection}**`;
        } else {
          selectionText = `le score **${leg.selection}**`;
        }

        embed.addFields({
          name: `${i + 1}. ${match.kcTeam} vs ${match.opponent}`,
          value: `${selectionText} (${leg.odds}x)`,
          inline: false,
        });
      }
    }

    await interaction.followUp({
      embeds: [embed],
      ephemeral: false,
    });

    logger.info(
      `Parlay announcement sent for user ${interaction.user.id} with ${parlayData.legs.length} legs`
    );
  } catch (error) {
    logger.error("Error sending parlay announcement:", error);
  }
}
