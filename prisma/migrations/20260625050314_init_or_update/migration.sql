-- CreateEnum
CREATE TYPE "LocationType" AS ENUM ('STATE', 'DISTRICT', 'TALUK', 'AREA', 'STREET');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequestType" AS ENUM ('EMERGENCY', 'NORMAL');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CREATED', 'PENDING_SUB_ADMIN', 'APPROVED_SUB_ADMIN', 'PENDING_ADMIN', 'APPROVED_ADMIN', 'PENDING_SUPER_ADMIN', 'APPROVED_STATE', 'REJECTED');

-- CreateEnum
CREATE TYPE "RSVPStatus" AS ENUM ('GOING', 'MAYBE', 'NOT_GOING', 'COMING', 'ON_THE_WAY', 'REACHED', 'UNABLE', 'CONTACT_REQUESTED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('SUPER_ADMIN', 'DISTRICT_INCHARGE', 'ADMIN', 'SUB_ADMIN', 'MEMBER');

-- CreateEnum
CREATE TYPE "AccessRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AccessRequestType" AS ENUM ('ROLE_CHANGE', 'LOCATION_CHANGE', 'BOTH');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SENT', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'PAUSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PAID', 'PENDING', 'FAILED');

-- CreateEnum
CREATE TYPE "ContributionBadge" AS ENUM ('BRONZE', 'SILVER', 'GOLD', 'PLATINUM');

-- CreateEnum
CREATE TYPE "ReminderNotificationType" AS ENUM ('PUSH', 'SMS', 'WHATSAPP');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'IGNORED', 'WARNED', 'DELETED');

-- CreateEnum
CREATE TYPE "CommunityGroupRole" AS ENUM ('OWNER', 'ADMIN', 'MODERATOR', 'MEMBER');

-- CreateEnum
CREATE TYPE "CommunityPrivacyType" AS ENUM ('PUBLIC', 'PRIVATE', 'SECRET');

-- CreateEnum
CREATE TYPE "GroupJoinStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "Location" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "type" "LocationType" NOT NULL,
    "parentId" INTEGER,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "surname" TEXT,
    "phone" TEXT NOT NULL,
    "password" TEXT,
    "image" TEXT,
    "dateOfBirth" TEXT,
    "gender" TEXT,
    "bloodGroup" TEXT,
    "allergies" TEXT,
    "conditions" TEXT,
    "emergencyContact" TEXT,
    "role" TEXT NOT NULL DEFAULT 'Member',
    "professionId" INTEGER,
    "locationId" INTEGER NOT NULL,
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "consent" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdById" INTEGER,
    "approvedById" INTEGER,
    "fcmToken" TEXT,
    "district" TEXT,
    "constituency" TEXT,
    "area" TEXT,
    "street" TEXT,

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Profession" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Profession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "surname" TEXT,
    "phone" TEXT NOT NULL,
    "password" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'MEMBER',
    "approvalStatus" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "locationId" INTEGER,
    "parentId" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "fcmToken" TEXT,
    "image" TEXT,
    "dateOfBirth" TEXT,
    "gender" TEXT,
    "bloodGroup" TEXT,
    "profession" TEXT,
    "district" TEXT,
    "constituency" TEXT,
    "area" TEXT,
    "street" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignTarget" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,

    CONSTRAINT "CampaignTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageLog" (
    "id" SERIAL NOT NULL,
    "campaignId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "phone" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "providerMessageId" TEXT,
    "errorMessage" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OTP" (
    "id" SERIAL NOT NULL,
    "phone" TEXT NOT NULL,
    "otp" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isVerified" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OTP_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Event" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "date" TIMESTAMP(3) NOT NULL,
    "locationId" INTEGER NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "communityId" INTEGER,

    CONSTRAINT "Event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EventResponse" (
    "id" SERIAL NOT NULL,
    "eventId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "status" "RSVPStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EventResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyRequest" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "type" TEXT NOT NULL DEFAULT 'EMERGENCY',
    "status" "RequestStatus" NOT NULL DEFAULT 'PENDING',
    "locationId" INTEGER NOT NULL,
    "memberId" INTEGER,
    "createdById" INTEGER,
    "audience" TEXT,
    "contactName" TEXT,
    "contactPhone" TEXT,
    "expiryDate" TIMESTAMP(3),
    "collectResponse" BOOLEAN NOT NULL DEFAULT true,
    "bloodGroup" TEXT,
    "unitsRequired" TEXT,
    "hospitalName" TEXT,
    "patientCondition" TEXT,
    "disasterType" TEXT,
    "affectedArea" TEXT,
    "requiredSupport" TEXT,
    "volunteerType" TEXT,
    "forwardedBy" TEXT,
    "forwardedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyResponse" (
    "id" SERIAL NOT NULL,
    "emergencyRequestId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "status" "RSVPStatus" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyResponse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Post" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT DEFAULT 'Discussion',
    "images" TEXT[],
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "locationId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdById" INTEGER,
    "createdByType" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "Post_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Poll" (
    "id" SERIAL NOT NULL,
    "question" TEXT NOT NULL,
    "locationId" INTEGER NOT NULL,
    "communityId" INTEGER,
    "memberId" INTEGER,
    "createdById" INTEGER,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Poll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollOption" (
    "id" SERIAL NOT NULL,
    "pollId" INTEGER NOT NULL,
    "text" TEXT NOT NULL,

    CONSTRAINT "PollOption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollVote" (
    "id" SERIAL NOT NULL,
    "pollId" INTEGER NOT NULL,
    "optionId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollVote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Comment" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "postId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommentLike" (
    "id" SERIAL NOT NULL,
    "commentId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommentLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "time" TEXT,
    "purpose" TEXT,
    "entityType" TEXT,
    "entityId" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "metadata" JSONB,
    "locationId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "image" TEXT,
    "scope" "LocationType" NOT NULL,
    "locationId" INTEGER NOT NULL,
    "createdById" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Community" (
    "id" SERIAL NOT NULL,
    "role" "UserRole",
    "locationId" INTEGER,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "descriptionEn" TEXT,
    "image" TEXT,
    "allowMemberMessages" BOOLEAN NOT NULL DEFAULT true,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil" TIMESTAMP(3),
    "pinnedMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "privacyType" "CommunityPrivacyType" NOT NULL DEFAULT 'PUBLIC',
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "verificationType" TEXT NOT NULL DEFAULT 'NONE',
    "inviteCode" TEXT,
    "inviteCodeExpiry" TIMESTAMP(3),
    "isArchived" BOOLEAN NOT NULL DEFAULT false,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Community_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityPost" (
    "id" SERIAL NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT DEFAULT 'Information',
    "images" TEXT[],
    "communityId" INTEGER NOT NULL,
    "createdById" INTEGER,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "memberId" INTEGER,

    CONSTRAINT "CommunityPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMember" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "isMuted" BOOLEAN NOT NULL DEFAULT false,
    "mutedUntil" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "lastReadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "groupRole" "CommunityGroupRole" NOT NULL DEFAULT 'MEMBER',
    "notificationPref" TEXT NOT NULL DEFAULT 'ALL',

    CONSTRAINT "CommunityMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityComment" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMessage" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "senderId" INTEGER NOT NULL,
    "senderType" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'TEXT',
    "mediaUrl" TEXT,
    "mediaType" TEXT,
    "fileName" TEXT,
    "metadata" JSONB,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "replyToMessageId" INTEGER,
    "editedAt" TIMESTAMP(3),
    "isDeleted" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMessageReaction" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "reactorId" INTEGER NOT NULL,
    "reactorType" TEXT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMessageReaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMessageRead" (
    "id" SERIAL NOT NULL,
    "messageId" INTEGER NOT NULL,
    "readerId" INTEGER NOT NULL,
    "readerType" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMessageRead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionPlan" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "monthlyAmount" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "autoRenewEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberPlanEnrollment" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "planId" INTEGER NOT NULL,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MemberPlanEnrollment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionPayment" (
    "id" SERIAL NOT NULL,
    "enrollmentId" INTEGER,
    "memberId" INTEGER NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "month" INTEGER NOT NULL,
    "year" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "orderId" TEXT,
    "transactionId" TEXT,
    "paymentMethod" TEXT,
    "paidAt" TIMESTAMP(3),
    "receiptNumber" TEXT,
    "receiptUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionProfile" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "totalPaidMonths" INTEGER NOT NULL DEFAULT 0,
    "currentStreak" INTEGER NOT NULL DEFAULT 0,
    "totalContribution" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "badge" "ContributionBadge" NOT NULL DEFAULT 'BRONZE',
    "contributionRank" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostLike" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityPostLike" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPostLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostReport" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "reportedById" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PostReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityPostReport" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "reportedById" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityPostReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserWarning" (
    "id" SERIAL NOT NULL,
    "memberId" INTEGER NOT NULL,
    "adminId" INTEGER NOT NULL,
    "message" TEXT NOT NULL,
    "postId" INTEGER,
    "communityPostId" INTEGER,
    "pollId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserWarning_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollLike" (
    "id" SERIAL NOT NULL,
    "pollId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollComment" (
    "id" SERIAL NOT NULL,
    "content" TEXT NOT NULL,
    "authorName" TEXT NOT NULL,
    "authorRole" TEXT,
    "pollId" INTEGER NOT NULL,
    "parentId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollCommentLike" (
    "id" SERIAL NOT NULL,
    "pollCommentId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PollCommentLike_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PollReport" (
    "id" SERIAL NOT NULL,
    "pollId" INTEGER NOT NULL,
    "reportedById" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PollReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeletedNotification" (
    "id" SERIAL NOT NULL,
    "notificationId" INTEGER NOT NULL,
    "userId" INTEGER,
    "memberId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeletedNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserLocation" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationAccessRequest" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "currentRole" "UserRole" NOT NULL,
    "requestedRole" "UserRole" NOT NULL,
    "requestType" "AccessRequestType" NOT NULL,
    "status" "AccessRequestStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "rejectionReason" TEXT,
    "approvedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationAccessRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequestLocation" (
    "id" SERIAL NOT NULL,
    "requestId" INTEGER NOT NULL,
    "locationId" INTEGER NOT NULL,

    CONSTRAINT "RequestLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityJoinRequest" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "status" "GroupJoinStatus" NOT NULL DEFAULT 'PENDING',
    "reason" TEXT,
    "rejectionReason" TEXT,
    "reviewedById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityJoinRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityAdminLog" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "adminId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityAdminLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityComplaint" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "assigneeId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityComplaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityBan" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "reason" TEXT,
    "bannedById" INTEGER NOT NULL,
    "bannedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityBan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityAnnouncement" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "createdById" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scheduledFor" TIMESTAMP(3),
    "isPinned" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CommunityAnnouncement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMemberActivity" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "memberId" INTEGER NOT NULL,
    "action" TEXT NOT NULL,
    "details" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMemberActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMemberReport" (
    "id" SERIAL NOT NULL,
    "communityId" INTEGER NOT NULL,
    "reportedUserId" INTEGER NOT NULL,
    "reporterId" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityMemberReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Location_parentId_idx" ON "Location"("parentId");

-- CreateIndex
CREATE INDEX "Location_type_idx" ON "Location"("type");

-- CreateIndex
CREATE UNIQUE INDEX "Member_phone_key" ON "Member"("phone");

-- CreateIndex
CREATE INDEX "Member_locationId_idx" ON "Member"("locationId");

-- CreateIndex
CREATE INDEX "Member_professionId_idx" ON "Member"("professionId");

-- CreateIndex
CREATE UNIQUE INDEX "Profession_name_key" ON "Profession"("name");

-- CreateIndex
CREATE UNIQUE INDEX "User_phone_key" ON "User"("phone");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_approvalStatus_idx" ON "User"("approvalStatus");

-- CreateIndex
CREATE INDEX "OTP_phone_idx" ON "OTP"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "EventResponse_eventId_memberId_key" ON "EventResponse"("eventId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyResponse_emergencyRequestId_memberId_key" ON "EmergencyResponse"("emergencyRequestId", "memberId");

-- CreateIndex
CREATE INDEX "Poll_locationId_idx" ON "Poll"("locationId");

-- CreateIndex
CREATE INDEX "Poll_communityId_idx" ON "Poll"("communityId");

-- CreateIndex
CREATE UNIQUE INDEX "PollVote_pollId_memberId_key" ON "PollVote"("pollId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "CommentLike_commentId_memberId_key" ON "CommentLike"("commentId", "memberId");

-- CreateIndex
CREATE INDEX "Notification_locationId_idx" ON "Notification"("locationId");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_entityType_entityId_idx" ON "Notification"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "Broadcast_locationId_idx" ON "Broadcast"("locationId");

-- CreateIndex
CREATE INDEX "Broadcast_createdById_idx" ON "Broadcast"("createdById");

-- CreateIndex
CREATE INDEX "Broadcast_scope_idx" ON "Broadcast"("scope");

-- CreateIndex
CREATE UNIQUE INDEX "Community_name_key" ON "Community"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Community_inviteCode_key" ON "Community"("inviteCode");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMember_communityId_memberId_key" ON "CommunityMember"("communityId", "memberId");

-- CreateIndex
CREATE INDEX "CommunityMessage_communityId_createdAt_idx" ON "CommunityMessage"("communityId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityMessage_senderId_senderType_idx" ON "CommunityMessage"("senderId", "senderType");

-- CreateIndex
CREATE INDEX "CommunityMessageReaction_messageId_idx" ON "CommunityMessageReaction"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMessageReaction_messageId_reactorId_reactorType_key" ON "CommunityMessageReaction"("messageId", "reactorId", "reactorType");

-- CreateIndex
CREATE INDEX "CommunityMessageRead_messageId_idx" ON "CommunityMessageRead"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMessageRead_messageId_readerId_readerType_key" ON "CommunityMessageRead"("messageId", "readerId", "readerType");

-- CreateIndex
CREATE INDEX "ContributionPlan_isActive_idx" ON "ContributionPlan"("isActive");

-- CreateIndex
CREATE INDEX "MemberPlanEnrollment_memberId_idx" ON "MemberPlanEnrollment"("memberId");

-- CreateIndex
CREATE INDEX "MemberPlanEnrollment_planId_idx" ON "MemberPlanEnrollment"("planId");

-- CreateIndex
CREATE INDEX "MemberPlanEnrollment_status_idx" ON "MemberPlanEnrollment"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MemberPlanEnrollment_memberId_planId_key" ON "MemberPlanEnrollment"("memberId", "planId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionPayment_orderId_key" ON "ContributionPayment"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionPayment_transactionId_key" ON "ContributionPayment"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionPayment_receiptNumber_key" ON "ContributionPayment"("receiptNumber");

-- CreateIndex
CREATE INDEX "ContributionPayment_memberId_idx" ON "ContributionPayment"("memberId");

-- CreateIndex
CREATE INDEX "ContributionPayment_status_idx" ON "ContributionPayment"("status");

-- CreateIndex
CREATE INDEX "ContributionPayment_month_year_idx" ON "ContributionPayment"("month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionPayment_memberId_month_year_key" ON "ContributionPayment"("memberId", "month", "year");

-- CreateIndex
CREATE UNIQUE INDEX "ContributionProfile_memberId_key" ON "ContributionProfile"("memberId");

-- CreateIndex
CREATE INDEX "ContributionProfile_badge_idx" ON "ContributionProfile"("badge");

-- CreateIndex
CREATE INDEX "ContributionProfile_totalContribution_idx" ON "ContributionProfile"("totalContribution" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "PostLike_postId_memberId_key" ON "PostLike"("postId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityPostLike_postId_memberId_key" ON "CommunityPostLike"("postId", "memberId");

-- CreateIndex
CREATE INDEX "PostReport_postId_idx" ON "PostReport"("postId");

-- CreateIndex
CREATE INDEX "PostReport_reportedById_idx" ON "PostReport"("reportedById");

-- CreateIndex
CREATE UNIQUE INDEX "PostReport_postId_reportedById_key" ON "PostReport"("postId", "reportedById");

-- CreateIndex
CREATE INDEX "CommunityPostReport_postId_idx" ON "CommunityPostReport"("postId");

-- CreateIndex
CREATE INDEX "CommunityPostReport_reportedById_idx" ON "CommunityPostReport"("reportedById");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityPostReport_postId_reportedById_key" ON "CommunityPostReport"("postId", "reportedById");

-- CreateIndex
CREATE INDEX "UserWarning_memberId_idx" ON "UserWarning"("memberId");

-- CreateIndex
CREATE INDEX "UserWarning_adminId_idx" ON "UserWarning"("adminId");

-- CreateIndex
CREATE UNIQUE INDEX "PollLike_pollId_memberId_key" ON "PollLike"("pollId", "memberId");

-- CreateIndex
CREATE UNIQUE INDEX "PollCommentLike_pollCommentId_memberId_key" ON "PollCommentLike"("pollCommentId", "memberId");

-- CreateIndex
CREATE INDEX "PollReport_pollId_idx" ON "PollReport"("pollId");

-- CreateIndex
CREATE INDEX "PollReport_reportedById_idx" ON "PollReport"("reportedById");

-- CreateIndex
CREATE UNIQUE INDEX "PollReport_pollId_reportedById_key" ON "PollReport"("pollId", "reportedById");

-- CreateIndex
CREATE INDEX "DeletedNotification_notificationId_idx" ON "DeletedNotification"("notificationId");

-- CreateIndex
CREATE INDEX "DeletedNotification_userId_idx" ON "DeletedNotification"("userId");

-- CreateIndex
CREATE INDEX "DeletedNotification_memberId_idx" ON "DeletedNotification"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "DeletedNotification_notificationId_userId_key" ON "DeletedNotification"("notificationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "DeletedNotification_notificationId_memberId_key" ON "DeletedNotification"("notificationId", "memberId");

-- CreateIndex
CREATE INDEX "UserLocation_userId_idx" ON "UserLocation"("userId");

-- CreateIndex
CREATE INDEX "UserLocation_locationId_idx" ON "UserLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "UserLocation_userId_locationId_key" ON "UserLocation"("userId", "locationId");

-- CreateIndex
CREATE INDEX "LocationAccessRequest_userId_idx" ON "LocationAccessRequest"("userId");

-- CreateIndex
CREATE INDEX "LocationAccessRequest_status_idx" ON "LocationAccessRequest"("status");

-- CreateIndex
CREATE INDEX "LocationAccessRequest_requestType_idx" ON "LocationAccessRequest"("requestType");

-- CreateIndex
CREATE INDEX "RequestLocation_requestId_idx" ON "RequestLocation"("requestId");

-- CreateIndex
CREATE INDEX "RequestLocation_locationId_idx" ON "RequestLocation"("locationId");

-- CreateIndex
CREATE UNIQUE INDEX "RequestLocation_requestId_locationId_key" ON "RequestLocation"("requestId", "locationId");

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_professionId_fkey" FOREIGN KEY ("professionId") REFERENCES "Profession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignTarget" ADD CONSTRAINT "CampaignTarget_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageLog" ADD CONSTRAINT "MessageLog_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Event" ADD CONSTRAINT "Event_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResponse" ADD CONSTRAINT "EventResponse_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EventResponse" ADD CONSTRAINT "EventResponse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyRequest" ADD CONSTRAINT "EmergencyRequest_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyRequest" ADD CONSTRAINT "EmergencyRequest_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyRequest" ADD CONSTRAINT "EmergencyRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyResponse" ADD CONSTRAINT "EmergencyResponse_emergencyRequestId_fkey" FOREIGN KEY ("emergencyRequestId") REFERENCES "EmergencyRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyResponse" ADD CONSTRAINT "EmergencyResponse_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Post" ADD CONSTRAINT "Post_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Poll" ADD CONSTRAINT "Poll_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollOption" ADD CONSTRAINT "PollOption_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "PollOption"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollVote" ADD CONSTRAINT "PollVote_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "Comment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommentLike" ADD CONSTRAINT "CommentLike_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Broadcast" ADD CONSTRAINT "Broadcast_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Community" ADD CONSTRAINT "Community_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMember" ADD CONSTRAINT "CommunityMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMessage" ADD CONSTRAINT "CommunityMessage_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMessage" ADD CONSTRAINT "CommunityMessage_replyToMessageId_fkey" FOREIGN KEY ("replyToMessageId") REFERENCES "CommunityMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMessageReaction" ADD CONSTRAINT "CommunityMessageReaction_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunityMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMessageRead" ADD CONSTRAINT "CommunityMessageRead_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunityMessage"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPlanEnrollment" ADD CONSTRAINT "MemberPlanEnrollment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberPlanEnrollment" ADD CONSTRAINT "MemberPlanEnrollment_planId_fkey" FOREIGN KEY ("planId") REFERENCES "ContributionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionPayment" ADD CONSTRAINT "ContributionPayment_enrollmentId_fkey" FOREIGN KEY ("enrollmentId") REFERENCES "MemberPlanEnrollment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionPayment" ADD CONSTRAINT "ContributionPayment_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionProfile" ADD CONSTRAINT "ContributionProfile_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostLike" ADD CONSTRAINT "PostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPostLike" ADD CONSTRAINT "CommunityPostLike_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPostLike" ADD CONSTRAINT "CommunityPostLike_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostReport" ADD CONSTRAINT "PostReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "Post"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostReport" ADD CONSTRAINT "PostReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarning" ADD CONSTRAINT "UserWarning_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserWarning" ADD CONSTRAINT "UserWarning_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollLike" ADD CONSTRAINT "PollLike_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollLike" ADD CONSTRAINT "PollLike_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollComment" ADD CONSTRAINT "PollComment_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollComment" ADD CONSTRAINT "PollComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PollComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollCommentLike" ADD CONSTRAINT "PollCommentLike_pollCommentId_fkey" FOREIGN KEY ("pollCommentId") REFERENCES "PollComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollCommentLike" ADD CONSTRAINT "PollCommentLike_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollReport" ADD CONSTRAINT "PollReport_pollId_fkey" FOREIGN KEY ("pollId") REFERENCES "Poll"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PollReport" ADD CONSTRAINT "PollReport_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedNotification" ADD CONSTRAINT "DeletedNotification_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedNotification" ADD CONSTRAINT "DeletedNotification_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "Notification"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeletedNotification" ADD CONSTRAINT "DeletedNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserLocation" ADD CONSTRAINT "UserLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAccessRequest" ADD CONSTRAINT "LocationAccessRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAccessRequest" ADD CONSTRAINT "LocationAccessRequest_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestLocation" ADD CONSTRAINT "RequestLocation_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "LocationAccessRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequestLocation" ADD CONSTRAINT "RequestLocation_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityJoinRequest" ADD CONSTRAINT "CommunityJoinRequest_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityJoinRequest" ADD CONSTRAINT "CommunityJoinRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAdminLog" ADD CONSTRAINT "CommunityAdminLog_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAdminLog" ADD CONSTRAINT "CommunityAdminLog_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComplaint" ADD CONSTRAINT "CommunityComplaint_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComplaint" ADD CONSTRAINT "CommunityComplaint_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityComplaint" ADD CONSTRAINT "CommunityComplaint_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBan" ADD CONSTRAINT "CommunityBan_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBan" ADD CONSTRAINT "CommunityBan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBan" ADD CONSTRAINT "CommunityBan_bannedById_fkey" FOREIGN KEY ("bannedById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAnnouncement" ADD CONSTRAINT "CommunityAnnouncement_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityAnnouncement" ADD CONSTRAINT "CommunityAnnouncement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMemberActivity" ADD CONSTRAINT "CommunityMemberActivity_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMemberActivity" ADD CONSTRAINT "CommunityMemberActivity_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMemberReport" ADD CONSTRAINT "CommunityMemberReport_communityId_fkey" FOREIGN KEY ("communityId") REFERENCES "Community"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMemberReport" ADD CONSTRAINT "CommunityMemberReport_reportedUserId_fkey" FOREIGN KEY ("reportedUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMemberReport" ADD CONSTRAINT "CommunityMemberReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
