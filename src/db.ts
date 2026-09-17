import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Shared Prisma client with no side effects: importing it never starts the Discord bot.
export const prisma = new PrismaClient();
