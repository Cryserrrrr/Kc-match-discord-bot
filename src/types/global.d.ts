import { Collection } from "discord.js";

declare global {
  namespace NodeJS {
    interface Global {
      // Add any global types here if needed
    }
  }
}

declare module "discord.js" {
  export interface Client {
    commands: Collection<string, any>;
  }

  export class SlashCommandBuilder {
    setName(name: string): this;
    setDescription(description: string): this;
    addStringOption(option: any): this;
    addChannelOption(option: any): this;
    setDefaultMemberPermissions(permissions: any): this;
    toJSON(): any;
  }

  export class EmbedBuilder {
    setColor(color: number): this;
    setTitle(title: string): this;
    setDescription(description: string): this;
    addFields(fields: any[]): this;
    setTimestamp(): this;
    setFooter(footer: any): this;
  }

  export enum ChannelType {
    GuildText = 0,
  }

  export enum PermissionFlagsBits {
    ManageGuild = 1n << 5n,
  }

  export interface CommandInteraction {
    guildId: string | null;
    options: {
      getString(name: string, required?: boolean): string | null;
      getChannel(name: string): any;
    };
    reply(content: any): Promise<any>;
    editReply(content: any): Promise<any>;
    deferReply(): Promise<any>;
  }

  export interface ChatInputCommandInteraction extends CommandInteraction {
    createdTimestamp: number;
  }

  export interface TextChannel {
    send(content: any): Promise<any>;
  }

  export class REST {
    constructor(options: { version: string });
    setToken(token: string): this;
    put(route: any, options: any): Promise<any>;
  }

  export class Routes {
    static applicationCommands(clientId: string): string;
  }
}

export {};
