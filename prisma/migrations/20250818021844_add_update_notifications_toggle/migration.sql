-- AlterTable
ALTER TABLE "guild_settings" ADD COLUMN     "enableUpdateNotifications" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "matches" ALTER COLUMN "status" SET DEFAULT 'not_started';
