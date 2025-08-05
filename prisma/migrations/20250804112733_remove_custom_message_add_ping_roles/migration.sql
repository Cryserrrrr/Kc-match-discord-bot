/*
  Warnings:

  - You are about to drop the column `customMessage` on the `guild_settings` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "guild_settings" DROP COLUMN "customMessage",
ADD COLUMN     "pingRoles" TEXT[] DEFAULT ARRAY[]::TEXT[];
