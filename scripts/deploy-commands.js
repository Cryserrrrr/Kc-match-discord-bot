#!/usr/bin/env node

const { REST, Routes } = require("discord.js");
require("dotenv").config();

// Load commands dynamically from TypeScript files
const fs = require("fs");
const path = require("path");

function loadCommands() {
  const commands = [];
  const commandsPath = path.join(__dirname, "..", "src", "commands");

  const commandFiles = fs
    .readdirSync(commandsPath)
    .filter((file) => file.endsWith(".js") || file.endsWith(".ts"))
    .filter((file) => !file.endsWith(".d.ts"))
    .filter(
      (file) => file !== "commandLoader.js" && file !== "commandLoader.ts"
    );

  for (const file of commandFiles) {
    try {
      const filePath = path.join(commandsPath, file);
      const command = require(filePath);

      if (command.data) {
        const commandData = command.data.toJSON();
        // Check for duplicate names
        const existingCommand = commands.find(
          (cmd) => cmd.name === commandData.name
        );
        if (existingCommand) {
          console.log(`⚠️  Skipping duplicate command: ${commandData.name}`);
        } else {
          commands.push(commandData);
          console.log(`Loaded command: ${commandData.name}`);
        }
      }
    } catch (error) {
      console.error(`Error loading command from ${file}:`, error);
    }
  }

  return commands;
}

const commands = loadCommands();

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

      // First, delete all existing commands
      console.log("🗑️  Deleting existing commands...");
      await rest.put(
        Routes.applicationGuildCommands(
          process.env.CLIENT_ID,
          process.env.GUILD_ID
        ),
        { body: [] }
      );

      // Wait a moment for Discord to process the deletion
      console.log("⏳ Waiting for Discord to process deletion...");
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Use all loaded commands (including ping from the files)
      const devCommands = [...commands];

      console.log("📤 Deploying new commands...");
      console.log(
        "Commands to deploy:",
        devCommands.map((cmd) => cmd.name)
      );

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

      // First, delete all existing commands
      console.log("🗑️  Deleting existing commands...");
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: [],
      });

      console.log("📤 Deploying new commands...");
      await rest.put(Routes.applicationCommands(process.env.CLIENT_ID), {
        body: commands,
      });

      console.log("✅ Successfully deployed commands globally for production.");
    }
  } catch (error) {
    console.error("❌ Error deploying commands:", error);
  }
})();
