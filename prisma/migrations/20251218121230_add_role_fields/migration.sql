-- AlterTable
ALTER TABLE "guild_settings" ADD COLUMN     "matchAnnouncementRole" TEXT,
ADD COLUMN     "teamRoles" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "twitchLiveRole" TEXT;
