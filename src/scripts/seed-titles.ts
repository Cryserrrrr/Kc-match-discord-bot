import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/logger";

const prisma = new PrismaClient();

const titles = [
  { name: "Débutant", icon: "🌱" },
  { name: "Parieur", icon: "🎲" },
  { name: "Stratège", icon: "🧠" },
  { name: "Gladiateur", icon: "⚔️" },
  { name: "Parieur Bronze", icon: "🥉" },
  { name: "Parieur Argent", icon: "🥈" },
  { name: "Parieur Or", icon: "🥇" },
  { name: "Parieur Légende", icon: "👑" },
  { name: "Duelliste Bronze", icon: "🥉" },
  { name: "Duelliste Argent", icon: "🥈" },
  { name: "Duelliste Or", icon: "🥇" },
  { name: "Maître Duelliste", icon: "🗡️" },
  { name: "Maestro du Combiné", icon: "🧩" },
  { name: "Jackpot", icon: "💰" },
  { name: "Champion", icon: "🏆" },
  { name: "Vice-Champion", icon: "🥈" },
  { name: "Troisième", icon: "🥉" },
  { name: "Mécène 10K", icon: "💸" },
  { name: "Mécène 50K", icon: "💵" },
  { name: "Mécène 100K", icon: "💰" },
  { name: "Organisé", icon: "🔥" },
  { name: "Rothschild", icon: "💼" },
  { name: "Bet Warrior", icon: "5️⃣" },
  { name: "Bet Prince", icon: "🔟" },
  { name: "Bet King", icon: "2️⃣5️⃣" },
  { name: "Bet God", icon: "5️⃣0️⃣" },
  { name: "Duellist Warrior", icon: "5️⃣" },
  { name: "Duellist Prince", icon: "🔟" },
  { name: "Duellist King", icon: "2️⃣5️⃣" },
  { name: "Duellist God", icon: "5️⃣0️⃣" },
  { name: "Combiner Warrior", icon: "5️⃣" },
  { name: "Combiner Prince", icon: "🔟" },
  { name: "Combiner King", icon: "2️⃣5️⃣" },
  { name: "Combiner God", icon: "5️⃣0️⃣" },
  { name: "Better", icon: "⭐" },
];

async function seedTitles() {
  try {
    logger.info("Starting title seeding...");

    for (const title of titles) {
      await prisma.title.upsert({
        where: { name: title.name },
        update: { icon: title.icon },
        create: { name: title.name, icon: title.icon },
      });
      logger.info(`Seeded title: ${title.icon} ${title.name}`);
    }

    logger.info("Title seeding completed successfully!");
  } catch (error) {
    logger.error("Error seeding titles:", error);
  } finally {
    await prisma.$disconnect();
  }
}

seedTitles();
