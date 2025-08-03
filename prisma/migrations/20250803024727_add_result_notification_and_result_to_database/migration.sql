-- AlterTable
ALTER TABLE "guild_settings" ADD COLUMN     "enableScoreNotifications" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "matches" ADD COLUMN     "score" TEXT,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'scheduled';
