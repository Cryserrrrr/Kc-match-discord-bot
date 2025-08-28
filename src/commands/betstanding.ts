import { SlashCommandBuilder } from "@discordjs/builders";
import { EmbedBuilder } from "discord.js";
import { prisma } from "../index";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("betstanding")
  .setDescription("Classement global");

export async function execute(interaction: any) {
  try {
    const entries = await prisma.user.findMany({
      orderBy: [{ points: "desc" }],
      take: 20,
    });

    const embed = new EmbedBuilder()
      .setColor(0x03a9f4)
      .setTitle("Classement Global")
      .setTimestamp();

    if (entries.length === 0) {
      embed.setDescription("Aucun joueur dans le classement.");
    } else {
      let text = "";
      entries.forEach((u: any, idx: number) => {
        text += `${idx + 1}. <@${u.id}> — ${u.points} Perticoin\n`;
      });
      embed.setDescription(text);
    }

    await interaction.editReply({ embeds: [embed], ephemeral: true });
  } catch (error) {
    logger.error("Error in betstanding command:", error);
    await interaction.editReply({
      content: "Erreur lors du classement.",
      ephemeral: true,
    });
  }
}
