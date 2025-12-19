#!/usr/bin/env node

import { PrismaClient } from "@prisma/client";
import { config } from "dotenv";
import { logger } from "../utils/logger";
import { ClientManager } from "../utils/clientManager";

config();

const TEAM_IDS = {
  LOL: {
    KC: "134078",
    KCB: "128268",
    KCBS: "136080",
  },
  VAL: {
    KC: "130922",
    KCGC: "132777",
    KCBS: "136165",
  },
  RL: {
    KC: "129570",
  },
};

const TEAM_NAMES = {
  "134078": "KC LoL",
  "128268": "KCB LoL",
  "136080": "KCBS LoL",
  "130922": "KC Valorant",
  "132777": "KCGC Valorant",
  "136165": "KCBS Valorant",
  "129570": "KC Rocket League",
};

interface PlayerData {
  twitchLogin: string;
  playerName: string;
  teamId: string;
  teamName: string;
}

const PLAYERS: PlayerData[] = [
  {
    twitchLogin: "canna",
    playerName: "Canna",
    teamId: TEAM_IDS.LOL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "yikelol",
    playerName: "Yike",
    teamId: TEAM_IDS.LOL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "caliste_lol",
    playerName: "Caliste",
    teamId: TEAM_IDS.LOL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "busiolol",
    playerName: "Busio",
    teamId: TEAM_IDS.LOL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "yukinocat1",
    playerName: "Yukino",
    teamId: TEAM_IDS.LOL.KCB,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KCB as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "kamiloo_lol",
    playerName: "Kamiloo",
    teamId: TEAM_IDS.LOL.KCB,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KCB as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "hazeltn",
    playerName: "Hazel",
    teamId: TEAM_IDS.LOL.KCB,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KCB as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "prime_0p",
    playerName: "Prime",
    teamId: TEAM_IDS.LOL.KCB,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KCB as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "koalaa_lol",
    playerName: "Koala",
    teamId: TEAM_IDS.LOL.KCBS,
    teamName: TEAM_NAMES[TEAM_IDS.LOL.KCBS as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "suygetsu",
    playerName: "SUYGETSU",
    teamId: TEAM_IDS.VAL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.VAL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "lewnval",
    playerName: "LewN",
    teamId: TEAM_IDS.VAL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.VAL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "sheydosvl",
    playerName: "Sheydos",
    teamId: TEAM_IDS.VAL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.VAL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "dos9vlr",
    playerName: "dos9",
    teamId: TEAM_IDS.VAL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.VAL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "avezvlr",
    playerName: "avez",
    teamId: TEAM_IDS.VAL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.VAL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "vatira_",
    playerName: "Vatira",
    teamId: TEAM_IDS.RL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.RL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "atowwwww",
    playerName: "Atow",
    teamId: TEAM_IDS.RL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.RL.KC as keyof typeof TEAM_NAMES],
  },
  {
    twitchLogin: "juicyyrl",
    playerName: "Juicy",
    teamId: TEAM_IDS.RL.KC,
    teamName: TEAM_NAMES[TEAM_IDS.RL.KC as keyof typeof TEAM_NAMES],
  },
];

async function main() {
  const prisma = ClientManager.getPrismaClient();

  try {
    logger.info("Seeding Twitch players...");

    const twitchLoginsInScript = PLAYERS.map((p) => p.twitchLogin);

    for (const player of PLAYERS) {
      const existing = await prisma.twitchPlayer.findUnique({
        where: { twitchLogin: player.twitchLogin },
      });

      if (existing) {
        await prisma.twitchPlayer.update({
          where: { twitchLogin: player.twitchLogin },
          data: {
            playerName: player.playerName,
            teamId: player.teamId,
            teamName: player.teamName,
            isActive: true,
          },
        });
        logger.info(`Updated player: ${player.playerName} (${player.teamName})`);
      } else {
        await prisma.twitchPlayer.create({
          data: {
            twitchLogin: player.twitchLogin,
            playerName: player.playerName,
            teamId: player.teamId,
            teamName: player.teamName,
            isActive: true,
          },
        });
        logger.info(`Created player: ${player.playerName} (${player.teamName})`);
      }
    }

    const deletedPlayers = await prisma.twitchPlayer.deleteMany({
      where: {
        twitchLogin: {
          notIn: twitchLoginsInScript,
        },
      },
    });

    if (deletedPlayers.count > 0) {
      logger.info(`Deleted ${deletedPlayers.count} players not in the script`);
    }

    logger.info(`Successfully seeded ${PLAYERS.length} Twitch players`);
  } catch (error) {
    logger.error("Error seeding Twitch players:", error);
    process.exit(1);
  } finally {
    await ClientManager.cleanup();
    process.exit(0);
  }
}

main();


