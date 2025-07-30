#!/usr/bin/env node

const { REST, Routes } = require("discord.js");
require("dotenv").config();

const commands = [
  {
    name: "nextmatch",
    description: "Afficher le prochain match de Karmine Corp",
    type: 1, // CHAT_INPUT
    options: [
      {
        name: "team",
        description: "Choisir une équipe spécifique de Karmine Corp",
        type: 3, // String type
        required: false,
        choices: [
          { name: "Toutes les équipes", value: "all" },
          { name: "KC (LEC)", value: "134078" },
          { name: "KCB (LFL)", value: "128268" },
          { name: "KCBS (LFL2)", value: "136080" },
          { name: "KC Valorant", value: "130922" },
          { name: "KCGC Valorant", value: "132777" },
          { name: "KCBS Valorant", value: "136165" },
          { name: "KC Rocket League", value: "129570" },
        ],
      },
    ],
  },
  {
    name: "setchannel",
    description: "Définir le salon Discord pour les annonces de matchs",
    type: 1, // CHAT_INPUT
    options: [
      {
        name: "channel",
        description: "Le salon où les annonces de matchs seront envoyées",
        type: 7, // Channel type
        required: true,
        channel_types: [0], // Guild text channel
      },
    ],
    default_member_permissions: "32", // Manage Server permission
  },
  {
    name: "setphrase",
    description: "Personnaliser le message d'annonce de match",
    type: 1, // CHAT_INPUT
    options: [
      {
        name: "message",
        description:
          "Message d'annonce personnalisé (ex: '@everyone Match du jour')",
        type: 3, // String type
        required: true,
        max_length: 500,
      },
    ],
    default_member_permissions: "32", // Manage Server permission
  },
  {
    name: "filterteams",
    description:
      "Choisir quelles équipes de Karmine Corp doivent être annoncées",
    type: 1, // CHAT_INPUT
    options: [
      {
        name: "teams",
        description:
          "Sélectionner les équipes à annoncer (vide = toutes les équipes)",
        type: 3, // String type
        required: false,
        choices: [
          { name: "KC (LEC)", value: "134078" },
          { name: "KCB (LFL)", value: "128268" },
          { name: "KCBS (LFL2)", value: "136080" },
          { name: "KC Valorant", value: "130922" },
          { name: "KCGC Valorant", value: "132777" },
          { name: "KCBS Valorant", value: "136165" },
          { name: "KC Rocket League", value: "129570" },
        ],
      },
    ],
    default_member_permissions: "32", // Manage Server permission
  },
];

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log("🔍 NODE_ENV:", process.env.NODE_ENV);
    const isDevelopment = process.env.NODE_ENV?.trim() === "development";
    console.log("🔍 isDevelopment:", isDevelopment);

    if (isDevelopment) {
      console.log("🛠️  Development mode: Deploying commands to guild...");

      if (!process.env.GUILD_ID) {
        console.error("❌ GUILD_ID is required for development mode!");
        process.exit(1);
      }

      // Add ping command only for development (guild-specific)
      const devCommands = [
        {
          name: "ping",
          description: "Check if the bot is working",
          type: 1, // CHAT_INPUT
        },
        ...commands,
      ];

      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID,
          process.env.GUILD_ID
        ),
        { body: devCommands }
      );

      console.log(
        "✅ Successfully deployed commands to guild for development."
      );
    } else {
      console.log("🚀 Production mode: Deploying commands globally...");

      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      });

      console.log("✅ Successfully deployed commands globally for production.");
    }
  } catch (error) {
    console.error("❌ Error deploying commands:", error);
  }
})();
