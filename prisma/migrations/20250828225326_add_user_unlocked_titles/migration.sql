-- CreateTable
CREATE TABLE "user_unlocked_titles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "titleId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_unlocked_titles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_unlocked_titles_userId_titleId_key" ON "user_unlocked_titles"("userId", "titleId");

-- AddForeignKey
ALTER TABLE "user_unlocked_titles" ADD CONSTRAINT "user_unlocked_titles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_unlocked_titles" ADD CONSTRAINT "user_unlocked_titles_titleId_fkey" FOREIGN KEY ("titleId") REFERENCES "titles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
