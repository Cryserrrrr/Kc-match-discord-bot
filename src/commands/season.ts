import { SlashCommandBuilder } from "@discordjs/builders";
import { EmbedBuilder } from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";
import { formatDateTime } from "../utils/dateUtils";

export const data = new SlashCommandBuilder()
  .setName("season")
  .setDescription("Afficher les informations de la saison en cours");

export async function execute(interaction: any) {
  try {
    const season = await prisma.season.findFirst({
      where: { status: "ACTIVE" },
      include: {
        participants: {
          orderBy: [{ points: "desc" }, { totalWon: "desc" }],
          take: 10,
        },
      },
    });

    if (!season) {
      await interaction.editReply({
        content: "Aucune saison active.",
        ephemeral: true,
      });
      return;
    }

    const count = await prisma.seasonParticipant.count({
      where: { seasonId: season.id },
    });

    const embed = new EmbedBuilder()
      .setColor(0x4caf50)
      .setTitle(`Saison en cours: ${season.name}`)
      .addFields(
        { name: "Statut", value: season.status, inline: true },
        {
          name: "Début",
          value: season.startsAt
            ? formatDateTime(season.startsAt, { withTz: false })
            : "—",
          inline: true,
        },
        {
          name: "Fin",
          value: season.endsAt
            ? formatDateTime(season.endsAt, { withTz: false })
            : "—",
          inline: true,
        },
        { name: "Participants", value: `${count}`, inline: true }
      )
      .setTimestamp();

    if (season.participants.length > 0) {
      const top = season.participants
        .map(
          (p: any, i: number) =>
            `${i + 1}. <@${p.userId}> — ${p.points} pts (W:${p.betsWon}/L:${
              p.betsLost
            })`
        )
        .join("\n");
      embed.addFields({ name: "Top 10", value: top });
    }

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    logger.error("Error in season command:", error);
    await interaction.editReply({
      content: "Erreur de saison.",
      ephemeral: true,
    });
  }
}
