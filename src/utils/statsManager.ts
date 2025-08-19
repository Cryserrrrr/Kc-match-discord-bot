import { prisma } from "../index";
import { logger } from "./logger";

export interface CommandExecutionData {
  guildId: string;
  commandName: string;
  userId: string;
  username: string;
  teamArg?: string;
  startTime: number;
  success: boolean;
  errorMessage?: string;
}

export class StatsManager {
  static async recordCommandExecution(
    data: CommandExecutionData
  ): Promise<void> {
    try {
      const endTime = Date.now();
      const responseTime = endTime - data.startTime;

      if (data.guildId) {
        await this.ensureGuildExists(data.guildId);
      }

      if (data.guildId) {
        await prisma.commandStat.create({
          data: {
            guild: {
              connect: { guildId: data.guildId },
            },
            commandName: data.commandName,
            userId: data.userId,
            username: data.username,
            teamArg: data.teamArg,
          },
        });
      }

      await prisma.performanceMetric.create({
        data: {
          guild: data.guildId
            ? {
                connect: { guildId: data.guildId },
              }
            : undefined,
          commandName: data.commandName,
          responseTime,
          success: data.success,
          errorMessage: data.errorMessage,
        },
      });
    } catch (error) {
      logger.error("Error recording command execution:", error);
    }
  }

  static async ensureGuildExists(
    guildId: string,
    guildName?: string,
    memberCount?: number
  ): Promise<void> {
    try {
      if (!guildId) {
        logger.warn("Cannot ensure guild exists: guildId is null or undefined");
        return;
      }

      if (guildId === "DM") {
        await prisma.guildSettings.upsert({
          where: { guildId },
          update: {
            name: "Messages Privés",
            memberCount: 0,
            updatedAt: new Date(),
          },
          create: {
            guildId,
            name: "Messages Privés",
            memberCount: 0,
            channelId: "",
          },
        });
        return;
      }

      await prisma.guildSettings.upsert({
        where: { guildId },
        update: {
          name: guildName,
          memberCount: memberCount,
          updatedAt: new Date(),
        },
        create: {
          guildId,
          name: guildName || "Unknown Guild",
          memberCount: memberCount || 0,
          channelId: "",
        },
      });
    } catch (error) {
      logger.error("Error ensuring guild exists:", error);
    }
  }

  static async createTicket(
    guildId: string,
    userId: string,
    username: string,
    type: "BUG" | "IMPROVEMENT",
    description?: string
  ): Promise<any> {
    try {
      await this.ensureGuildExists(guildId);

      const ticket = await prisma.ticket.create({
        data: {
          guild: {
            connect: { guildId },
          },
          userId,
          username,
          type,
          description,
        },
      });

      return ticket;
    } catch (error) {
      logger.error("Error creating ticket:", error);
      throw error;
    }
  }

  static async getCommandStatsByGuild(
    guildId: string,
    days: number = 30
  ): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stats = await prisma.commandStat.groupBy({
        by: ["commandName"],
        where: {
          guild: {
            guildId,
          },
          executedAt: {
            gte: startDate,
          },
        },
        _count: {
          commandName: true,
        },
      });

      return stats.map((stat: any) => ({
        commandName: stat.commandName,
        count: stat._count.commandName,
      }));
    } catch (error) {
      logger.error("Error getting command stats by guild:", error);
      return [];
    }
  }

  static async getGlobalCommandStats(days: number = 30): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const stats = await prisma.commandStat.groupBy({
        by: ["commandName"],
        where: {
          executedAt: {
            gte: startDate,
          },
        },
        _count: {
          commandName: true,
        },
      });

      return stats.map((stat: any) => ({
        commandName: stat.commandName,
        count: stat._count.commandName,
      }));
    } catch (error) {
      logger.error("Error getting global command stats:", error);
      return [];
    }
  }

  static async getAveragePerformanceMetrics(days: number = 30): Promise<any> {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const metrics = await prisma.performanceMetric.groupBy({
        by: ["commandName"],
        where: {
          executedAt: {
            gte: startDate,
          },
        },
        _avg: {
          responseTime: true,
        },
        _count: {
          commandName: true,
        },
      });

      return metrics.map((metric: any) => ({
        commandName: metric.commandName,
        averageResponseTime: Math.round(metric._avg.responseTime || 0),
        totalExecutions: metric._count.commandName,
      }));
    } catch (error) {
      logger.error("Error getting performance metrics:", error);
      return [];
    }
  }

  static async getGuildStats(): Promise<any> {
    try {
      const guilds = await prisma.guildSettings.findMany({
        include: {
          _count: {
            select: {
              commandStats: true,
              tickets: true,
            },
          },
        },
        orderBy: {
          memberCount: "desc",
        },
      });

      return guilds.map((guild: any) => ({
        id: guild.id,
        guildId: guild.guildId,
        name: guild.name,
        memberCount: guild.memberCount,
        totalCommands: guild._count.commandStats,
        totalTickets: guild._count.tickets,
        joinedAt: guild.joinedAt,
      }));
    } catch (error) {
      logger.error("Error getting guild stats:", error);
      return [];
    }
  }

  static async getGuildTickets(
    guildId: string,
    status?: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
  ): Promise<any> {
    try {
      const whereClause: any = {
        guild: {
          guildId,
        },
      };
      if (status) {
        whereClause.status = status;
      }

      const tickets = await prisma.ticket.findMany({
        where: whereClause,
        include: {
          guild: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return tickets;
    } catch (error) {
      logger.error("Error getting guild tickets:", error);
      return [];
    }
  }

  /**
   * Obtient les tickets d'un utilisateur
   */
  static async getUserTickets(userId: string): Promise<any> {
    try {
      const tickets = await prisma.ticket.findMany({
        where: { userId },
        include: {
          guild: true,
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      return tickets;
    } catch (error) {
      logger.error("Error getting user tickets:", error);
      return [];
    }
  }

  static async updateTicketStatus(
    ticketId: string,
    status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED"
  ): Promise<any> {
    try {
      const ticket = await prisma.ticket.update({
        where: { id: ticketId },
        data: { status },
      });

      return ticket;
    } catch (error) {
      logger.error("Error updating ticket status:", error);
      throw error;
    }
  }
}
