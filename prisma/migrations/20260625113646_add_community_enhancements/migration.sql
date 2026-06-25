-- AlterTable
ALTER TABLE "Community" ADD COLUMN     "isFeatured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "linksAndDocsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "tags" TEXT[];

-- AlterTable
ALTER TABLE "CommunityMember" ADD COLUMN     "mediaAutoDownload" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notificationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "role" TEXT NOT NULL DEFAULT 'MEMBER',
ADD COLUMN     "starredMessagesEnabled" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Member" ADD COLUMN     "lastActiveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "CommunityLinkOrDoc" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "uploadedBy" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityLinkOrDoc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMessageStar" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "messageId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "starredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMessageStar_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CommunityLinkOrDoc_communityId_idx" ON "CommunityLinkOrDoc"("communityId");

-- CreateIndex
CREATE INDEX "CommunityLinkOrDoc_uploadedBy_idx" ON "CommunityLinkOrDoc"("uploadedBy");

-- CreateIndex
CREATE INDEX "CommunityMessageStar_communityId_idx" ON "CommunityMessageStar"("communityId");

-- CreateIndex
CREATE INDEX "CommunityMessageStar_memberId_idx" ON "CommunityMessageStar"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMessageStar_messageId_memberId_key" ON "CommunityMessageStar"("messageId", "memberId");

-- AddForeignKey
ALTER TABLE "CommunityLinkOrDoc" ADD CONSTRAINT "CommunityLinkOrDoc_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;
