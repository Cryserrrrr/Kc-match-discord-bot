import { SlashCommandBuilder, ChatInputCommandInteraction } from "discord.js";
import { logger } from "../utils/logger";

export const data = new SlashCommandBuilder()
  .setName("ping")
  .setDescription("Vérifier si le bot fonctionne");

export async function execute(interaction: ChatInputCommandInteraction) {
  logger.info("Ping command executed");
  const start = Date.now();
  await interaction.deferReply(); // 👈 informe Discord qu'on répondra plus tard

  const latency = Date.now() - start;
  await interaction.editReply(`Pong ! 🏓 Latence : ${latency}ms`);
}
