import { gql } from 'graphql-tag';

export const typeDefs = gql`
  # Enums
  enum LocationType {
    STATE
    DISTRICT
    TALUK
    AREA
    STREET
  }

  enum Role {
    SUPER_ADMIN
    DISTRICT_INCHARGE
    ADMIN
    SUB_ADMIN
    MEMBER
  }

  enum ApprovalStatus {
    APPROVED
    PENDING
    REJECTED
  }

  enum EventStatus {
    ACTIVE
    INACTIVE
    COMPLETED
    CANCELLED
    UPCOMING
    EXPIRED
  }

  enum RequestStatus {
    PENDING
    IN_PROGRESS
    COMPLETED
    RESOLVED
    CREATED
    PENDING_SUB_ADMIN
    APPROVED_SUB_ADMIN
    PENDING_ADMIN
    APPROVED_ADMIN
    PENDING_SUPER_ADMIN
    APPROVED_STATE
    REJECTED
  }

  enum RSVPStatus {
    GOING
    MAYBE
    NOT_GOING
    COMING
    ON_THE_WAY
    REACHED
    UNABLE
    CONTACT_REQUESTED
  }

  enum BroadcastScope {
    STATE
    DISTRICT
    TALUK
    AREA
    STREET
  }

  # Core types
  type Location {
    id: Int!
    name: String!
    nameEn: String
    type: LocationType!
    parentId: Int
    parent: Location
    children: [Location!]!
    memberCount: Int!
    childCount: Int!
    events: [Event!]!
    requests: [EmergencyRequest!]!
    password: String
  }

  type LocationNode {
    id: Int!
    name: String!
    type: LocationType!
    children: [LocationNode!]!
  }

  type User {
    id: Int!
    name: String!
    surname: String
    role: Role!
    phone: String
    image: String
    profilePicture: String
    locationId: Int
    location: Location
    approvalStatus: ApprovalStatus!
    isActive: Boolean!
    createdAt: String
    addedBy: String!
    bloodGroup: String
    dateOfBirth: String
    gender: String
    profession: String
    district: String
    constituency: String
    area: String
    street: String
    fcmToken: String
    userLocations: [UserLocationAssignment!]!
    assignedLocationIds: [Int!]!
  }

  type Profession {
    id: Int!
    name: String!
    nameEn: String
  }

  type Member {
    id: Int!
    name: String!
    surname: String
    phone: String
    image: String
    profilePicture: String
    dateOfBirth: String
    gender: String
    bloodGroup: String
    allergies: String
    conditions: String
    emergencyContact: String
    role: String
    locationId: Int!
    location: Location!
    profession: String
    approvalStatus: ApprovalStatus!
    isActive: Boolean!
    approvedBy: User
    createdAt: String!
    activityHistory: [Activity!]!
    createdBy: User
    addedBy: String!
    district: String
    constituency: String
    area: String
    street: String
    fcmToken: String
  }


  type Event {
    id: Int!
    title: String!
    description: String
    location: Location!
    date: String!
    status: EventStatus!
    createdBy: User!
    createdAt: String!
    responses: [EventResponse!]!
    stats: EventStats!
    userResponse: String
    isCreator: Boolean!
  }

  type EventStats {
    going: Int!
    maybe: Int!
    notGoing: Int!
  }

  type EventResponse {
    eventId: Int!
    memberId: Int!
    status: String!
    member: Member!
  }

  type EmergencyResponse {
    id: Int!
    emergencyRequestId: Int!
    memberId: Int!
    status: String!
    note: String
    member: Member!
    createdAt: String!
    updatedAt: String!
  }

  type EmergencyResponseStats {
    total: Int!
    going: Int!
    maybe: Int!
    notGoing: Int!
    coming: Int!
    onTheWay: Int!
    reached: Int!
    unable: Int!
    contactRequested: Int!
  }

  type EmergencyRequest {
    id: Int!
    title: String!
    description: String
    type: String!
    status: RequestStatus!
    audience: String
    location: Location!
    member: Member
    createdBy: User
    contactName: String
    contactPhone: String
    expiryDate: String
    collectResponse: Boolean!
    bloodGroup: String
    unitsRequired: String
    hospitalName: String
    patientCondition: String
    disasterType: String
    affectedArea: String
    requiredSupport: String
    volunteerType: String
    forwardedBy: String
    forwardedAt: String
    createdAt: String!
    responses: [EmergencyResponse!]!
    stats: EmergencyResponseStats!
  }

  type Broadcast {
    id: Int!
    title: String!
    message: String!
    image: String
    location: Location!
    scope: BroadcastScope!
    createdBy: User!
    isActive: Boolean!
    createdAt: String!
    updatedAt: String!
    recipientCount: Int!
  }

  type Community {
    id: Int!
    name: String!
    description: String
    image: String
    allowMemberMessages: Boolean!
    isMuted: Boolean!
    mutedUntil: String
    pinnedMessageId: Int
    pinnedMessage: CommunityMessage
    unreadCount: Int!
    memberCount: Int!
    locationId: Int
    location: Location
    locationName: String
    createdAt: String!
    isJoined: Boolean!
    rules: [String!]!
    privacyType: CommunityPrivacyType!
    isArchived: Boolean!
    userRole: CommunityGroupRole
    announcementCount: Int!
    eventCount: Int!
    tags: [String!]!
  }

  type CommunityMessageReaction {
    id: Int!
    messageId: Int!
    reactorId: Int!
    reactorType: String!
    reactorName: String!
    emoji: String!
    createdAt: String!
  }

  type CommunityMessage {
    id: Int!
    communityId: Int!
    senderId: Int!
    senderType: String!
    senderName: String!
    message: String!
    messageType: String!
    mediaUrl: String
    mediaType: String
    fileName: String
    metadata: String
    status: String!
    replyToMessageId: Int
    replyTo: CommunityMessage
    editedAt: String
    isDeleted: Boolean!
    deletedAt: String
    reactions: [CommunityMessageReaction!]!
    readByCount: Int!
    createdAt: String!
  }

  type Comment {
    id: Int!
    content: String!
    authorName: String!
    authorRole: String!
    createdAt: String!
    createdBy: User
    parentId: Int
    replies: [Comment!]!
    likesCount: Int!
    isLiked: Boolean!
  }

  type CommunityPost {
    id: Int!
    title: String!
    content: String!
    category: String
    image: String
    images: [String!]
    documents: [String!]!
    attachments: [String!]!
    authorName: String
    authorRole: String
    likes: Int!
    commentCount: Int!
    community: Community!
    createdBy: User
    location: Location
    comments: [Comment!]!
    createdAt: String!
    isLiked: Boolean!
  }

  type Notification {
    id: Int!
    title: String!
    message: String!
    type: String!
    purpose: String
    entityType: String
    entityId: Int
    status: String!
    metadata: String
    locationId: Int!
    location: Location
    createdBy: User
    createdAt: String!
  }

  type LocationScope {
    state: String
    district: String
    constituency: String
    area: String
    street: String
    label: String!
  }

  type NotificationActivity {
    title: String!
    description: String
    actorName: String
    status: String
    createdAt: String!
  }

  type NotificationAction {
    key: String!
    label: String!
    style: String!
  }

  type NotificationDeliveryStats {
    totalRecipients: Int!
    readCount: Int!
    unreadCount: Int!
    deliveredCount: Int!
  }

  type NotificationDetails {
    notification: Notification!
    notificationId: Int!
    notificationTypeBadge: String!
    statusBadge: String!
    purpose: String
    createdBy: User
    locationScope: LocationScope!
    responseRequired: Boolean!
    responseSummary: EmergencyResponseStats
    deliveryStats: NotificationDeliveryStats
    activityHistory: [NotificationActivity!]!
    availableActions: [NotificationAction!]!
    emergency: EmergencyRequest
    broadcast: Broadcast
    event: Event
    communityPost: CommunityPost
    memberRequest: Member
  }

  type Campaign {
    id: Int!
    title: String!
    message: String!
    status: String!
    createdAt: String!
    createdBy: User!
  }

  type Post {
    id: Int!
    content: String!
    category: String
    image: String
    images: [String!]
    authorName: String!
    authorRole: String!
    locationId: Int!
    location: Location!
    likes: Int!
    comments: [Comment!]!
    commentCount: Int!
    createdAt: String!
    feedScore: Float
    createdById: Int
    createdByType: String
    status: String!
    reportCount: Int!
    reportReasons: [String!]!
    reportedUsersCount: Int!
    isHighPriority: Boolean!
    isUnderReview: Boolean!
    hasWarning: Boolean!
    reports: [PostReport!]!
    isLiked: Boolean!
    createdBy: User
  }

  type PollOption {
    id: Int!
    pollId: Int!
    text: String!
    votesCount: Int!
  }

  type Poll {
    id: Int!
    question: String!
    locationId: Int!
    location: Location!
    communityId: Int
    expiresAt: String!
    createdAt: String!
    options: [PollOption!]!
    votesCount: Int!
    userVoteOptionId: Int
    createdBy: User
    member: Member
    likesCount: Int!
    commentsCount: Int!
    isLiked: Boolean!
    comments: [PollComment!]!
    likesList: [PollLike!]!
    status: String!
    reports: [PollReport!]!
  }

  type PollLike {
    id: Int!
    pollId: Int!
    memberId: Int!
    member: Member!
    createdAt: String!
  }

  type PollComment {
    id: Int!
    content: String!
    pollId: Int!
    authorName: String!
    authorRole: String!
    createdAt: String!
    parentId: Int
    replies: [PollComment!]!
    likesCount: Int!
    isLiked: Boolean!
  }

  type PollReport {
    id: Int!
    pollId: Int!
    poll: Poll!
    reportedById: Int!
    reportedBy: Member!
    reason: String!
    status: ReportStatus!
    createdAt: String!
  }

  type CommunityComment {
    id: Int!
    content: String!
    postId: Int!
    authorName: String!
    authorRole: String!
    createdAt: String!
  }

  type TownWithStreets {
    town: Location!
    streets: [Location!]!
  }

  # Root Query and Mutation
  type DashboardStats {
    locationName: String!
    totalSuperAdmins: Int!
    totalAdmins: Int!
    totalSubAdmins: Int!
    totalMembers: Int!
    pendingApprovals: Int!
    newMembersToday: Int!
    approvedToday: Int!
    totalTowns: Int!
    totalStreets: Int!
    activeEvents: Int!
    emergencyRequests: Int!
    activeBroadcasts: Int!
  }

  type ModerationDashboardStats {
    totalReportedPosts: Int!
    pendingReviews: Int!
    warningSentCount: Int!
    deletedPostsCount: Int!
    highPriorityReportsCount: Int!
  }

  enum ModerationAction {
    KEEP
    WARN
    DELETE
  }

  type ModerationResult {
    id: Int
    postId: Int
    success: Boolean!
    message: String!
    action: String
  }

  type Query {
    getLocationList(parentId: Int, type: LocationType): [Location!]!
    getLocationDetails(id: Int!): Location
    getFullLocationTree(constituencyId: Int!): LocationNode!
    getTownsAndStreets(constituencyId: Int!): [TownWithStreets!]!
    me: User
    getMemberList(locationId: Int, professionName: String, bloodGroup: String, role: String, search: String, limit: Int, offset: Int, approvalStatus: ApprovalStatus): [Member!]!
    getMemberDetails(id: Int!, communityId: Int): Member
    recentActivity(
      locationId: Int
      limit: Int = 10
      offset: Int = 0
      search: String
      type: ActivityType
      fromDate: String
      toDate: String
    ): [RecentActivity!]!
    professions: [Profession!]!
    communityFeed(locationId: Int): [Post!]!
    getPollList(locationId: Int, communityId: Int): [Poll!]!
    getPollDetails(id: Int!): Poll
    getEmergencyRequestDetails(id: Int!): EmergencyRequest
    getEventDetails(id: Int!): Event
    getBroadcastDetails(id: Int!): Broadcast
    getPostDetails(id: Int!): Post
    notifications(locationId: Int): [Notification!]!
    getNotificationDetails(id: Int!): NotificationDetails
    getEventList(locationId: Int, status: EventStatus, eventId: Int): [Event!]!
    getEmergencyRequestList(locationId: Int, status: RequestStatus): [EmergencyRequest!]!
    getCommunities(joinedOnly: Boolean, privacyType: CommunityPrivacyType): [Community!]!
    getCommunityPosts(communityId: Int!, category: String): [CommunityPost!]!
    getCommunityMessages(communityId: Int!, limit: Int = 50, beforeMessageId: Int): [CommunityMessage!]!
    getCommunityUnreadCount(communityId: Int!): Int!
    getCommunityMembers(communityId: Int!, role: String, search: String, limit: Int, offset: Int): [CommunityMemberDetail!]!
    getTargetableLocations(parentId: Int): [Location!]!
    getBroadcastList(locationId: Int, scope: BroadcastScope, broadcastId: Int, isActive: Boolean): [Broadcast!]!
    getBroadcasts(locationId: Int, scope: BroadcastScope, broadcastId: Int, isActive: Boolean): [Broadcast!]!
    pendingMembers(locationId: Int): [Member!]!
    bloodGroups: [String!]!
    dashboardStats(locationId: Int, filterLocationId: Int): DashboardStats!
    getContributionPlans(isActive: Boolean): [ContributionPlan!]!
    getContributionPlanDetails(id: Int!): ContributionPlan
    myContributionPlan: MemberPlanEnrollment
    getPaymentHistory(month: Int, year: Int, status: PaymentStatus): [ContributionPayment!]!
    downloadReceipt(paymentId: Int!): ReceiptDetails!
    getContributionProfile(memberId: Int): ContributionProfile!
    getContributionDashboard(state: String, district: String, constituency: String, area: String): ContributionDashboardStats!
    getContributionAnalytics: ContributionAnalytics!
    getPendingPayments(district: String, constituency: String, area: String): [PendingPayment!]!
    getContributionLeaderboard: ContributionLeaderboard!
    getReportedPosts(locationId: Int, status: String): [Post!]!
    getReportedCommunityPosts(status: ReportStatus): [CommunityPostReport!]!
    getReportedPolls(status: ReportStatus): [PollReport!]!
    getUserWarnings(memberId: Int!): [UserWarning!]!
    getModerationDashboardStats(locationId: Int): ModerationDashboardStats!
    getReportedPostsList(locationId: Int, status: String): [Post!]!
    # Multi-Location Role System
    getPendingLocationAccessRequests: [LocationAccessRequest!]!
    getMyLocationAccessRequests: [LocationAccessRequest!]!
    getUserAssignedLocations(userId: Int!): [UserLocationAssignment!]!
    # Community Module Enhancements Queries
    getPendingCommunityJoinRequests(communityId: Int!, status: String): [CommunityJoinRequest!]!
    getCommunityAdminLogs(communityId: Int!): [CommunityAdminLog!]!
    getCommunityComplaints(communityId: Int!, status: String): [CommunityComplaint!]!
    generateCommunityInviteLink(communityId: Int!, expiryDays: Int): String!
    getCommunityAnnouncements(communityId: Int!): [CommunityAnnouncement!]!
    getCommunityMediaGallery(communityId: Int!, mediaType: String): [CommunityMediaItem!]!
    getCommunityAnalytics(communityId: Int!): CommunityAnalytics!
    getCommunityBans(communityId: Int!): [CommunityBanInfo!]!
    # Additional Community APIs from images
    getCommunityDetails(communityId: Int!): Community!
    getFeaturedCommunities: [Community!]!
    getNearbyCommunities(locationId: Int, radiusKm: Int): [Community!]!
    searchCommunities(query: String!, locationId: Int): [Community!]!
    getCommunityRules(communityId: Int!): [String!]!
    getCommunityEvents(communityId: Int!): [Event!]!
    getCommunityInviteCode(communityId: Int!): String!
    getCommunitySettings(communityId: Int!): CommunitySettings!
    getCommunityRolesAndPermissions(communityId: Int!): [CommunityRolePermission!]!
    getCommunityStarredMessages(communityId: Int!): [CommunityMessage!]!
    getCommunityLinksAndDocs(communityId: Int!): [CommunityLinkOrDoc!]!
    getCommunityOnlineMembers(communityId: Int!): [CommunityMemberDetail!]!
  }

  type Mutation {
    # Mutations are defined in resolvers; placeholders added for schema validity.
    adminLogin(phone: String!, password: String!): AuthPayload
    createUser(
      name: String!
      surname: String
      phone: String!
      password: String!
      role: Role!
      image: String
      locationId: Int
      locationIds: [Int!]
      districtId: Int
      talukId: Int
      areaId: Int
      streetId: Int
      professionName: String
      bloodGroup: String
      dateOfBirth: String
      gender: String
    ): User
    addMember(
      name: String!
      surname: String
      phone: String!
      password: String
      image: String
      dateOfBirth: String
      gender: String
      bloodGroup: String
      allergies: String
      conditions: String
      emergencyContact: String
      role: String
      professionName: String
      locationId: Int
      districtId: Int
      talukId: Int
      areaId: Int
      streetId: Int
    ): Member
    updateMemberStatus(id: Int!, status: ApprovalStatus!): Member
    updateMember(
      id: Int!
      name: String
      surname: String
      phone: String
      password: String
      image: String
      profilePicture: String
      dateOfBirth: String
      gender: String
      bloodGroup: String
      allergies: String
      conditions: String
      emergencyContact: String
      role: String
      professionName: String
      locationId: Int
      districtId: Int
      talukId: Int
      areaId: Int
      streetId: Int
    ): Member
    createEvent(
      title: String!
      description: String
      date: String!
      locationId: Int!
      professionNames: [String!]
    ): Event!
    createCampaign(
      title: String!
      message: String!
      locationId: Int!
      professionNames: [String!]
    ): Campaign!
    createBroadcast(
      title: String!
      message: String!
      image: String
      locationId: Int!
    ): Broadcast!
    recallEvent(id: Int!): Boolean!
    recallCampaign(id: Int!): Boolean!
    recallBroadcast(id: Int!): Boolean!
    deleteBroadcast(id: Int!): Boolean!
    deleteEmergencyRequest(id: Int!): Boolean!
    completeEmergencyRequest(id: Int!): Boolean!
    deleteNotification(id: Int!): Boolean!
    respondToEvent(
      eventId: Int!
      memberId: Int!
      status: RSVPStatus!
    ): EventResponse!
    respondToEmergency(
      emergencyRequestId: Int!
      status: RSVPStatus!
      note: String
    ): EmergencyResponse!
    createEmergencyRequest(
      title: String!
      description: String
      type: String!
      locationId: Int!
      audience: String
      contactName: String
      contactPhone: String
      expiryDate: String
      collectResponse: Boolean
      bloodGroup: String
      unitsRequired: String
      hospitalName: String
      patientCondition: String
      disasterType: String
      affectedArea: String
      requiredSupport: String
      volunteerType: String
    ): EmergencyRequest!
    updateRequestStatus(
      id: Int!
      status: RequestStatus!
    ): EmergencyRequest!
    reviewEmergencyRequest(
      id: Int!
      action: String!
      rejectReason: String
    ): EmergencyRequest!
    createPost(
      title: String
      content: String!
      category: String
      images: [String!]
      image: String
      authorName: String!
      authorRole: String!
      locationId: Int!
    ): Post!
    editPost(
      id: Int!
      content: String!
      images: [String!]
    ): Post!
    deletePost(
      id: Int!
    ): Boolean!
    reportPost(postId: Int!, reason: String!): PostReport!
    reportCommunityPost(postId: Int!, reason: String!): CommunityPostReport!
    resolvePostReport(reportId: Int!, action: ReportAction!, warningMessage: String): ModerationResult!
    resolveCommunityPostReport(reportId: Int!, action: ReportAction!, warningMessage: String): ModerationResult!
    moderatePost(postId: Int!, action: ModerationAction!, warningMessage: String): ModerationResult!
    createPoll(
      question: String!
      options: [String!]!
      durationDays: Int!
      locationId: Int
      districtId: Int
      talukId: Int
      areaId: Int
      streetId: Int
      communityId: Int
    ): Poll!
    voteInPoll(pollId: Int!, optionId: Int!): Poll!
    likePoll(id: Int, pollId: Int): Poll!
    addPollComment(
      pollId: Int!
      content: String!
      authorName: String!
      authorRole: String!
      parentId: Int
    ): PollComment!
    likePollComment(pollCommentId: Int!): PollComment!
    reportPoll(pollId: Int!, reason: String!): PollReport!
    resolvePollReport(reportId: Int!, action: ReportAction!, warningMessage: String): Boolean!
    likePost(id: Int, postId: Int): Post!
    likeComment(commentId: Int!): Comment!
    addComment(
      postId: Int!
      content: String!
      authorName: String!
      authorRole: String!
      parentId: Int
    ): Comment!
    createNotification(
      title: String!
      message: String!
      type: String!
      locationId: Int!
      purpose: String
      entityType: String
      entityId: Int
      status: String
      metadata: String
    ): Notification!
    updateFcmToken(token: String!): Boolean!
    logout: Boolean!
    createCommunity(
      name: String!
      description: String
      image: String
      allowMemberMessages: Boolean
      locationId: Int
      privacyType: String
    ): Community!
    joinCommunity(
      communityId: Int!
      memberId: Int
    ): Boolean!
    leaveCommunity(
      communityId: Int!
      memberId: Int
    ): Boolean!
    createCommunityPost(
      communityId: Int!
      title: String!
      content: String!
      category: String
      images: [String!]
      documents: [String!]
    ): CommunityPost!
    likeCommunityPost(postId: Int!): CommunityPost!
    addCommunityComment(
      postId: Int!
      content: String!
    ): CommunityComment!
    sendCommunityMessage(
      communityId: Int!
      message: String!
      replyToMessageId: Int
      messageType: String
      mediaUrl: String
      mediaType: String
      fileName: String
    metadata: String
    ): CommunityMessage!
    editCommunityMessage(
      id: Int!
      message: String!
    ): CommunityMessage!
    deleteCommunityMessage(
      id: Int!
    ): Boolean!
    reactToCommunityMessage(
      messageId: Int!
      emoji: String!
    ): CommunityMessage!
    markCommunityMessagesRead(
      communityId: Int!
      messageIds: [Int!]!
    ): Boolean!
    updateCommunityChatSettings(
      communityId: Int!
      allowMemberMessages: Boolean
      isMuted: Boolean
      mutedUntil: String
      pinnedMessageId: Int
    ): Community!
    muteCommunityMember(
      communityId: Int!
      memberId: Int!
      mutedUntil: String
    ): Boolean!
    removeCommunityMember(
      communityId: Int!
      memberId: Int!
    ): Boolean!
    changeUserRole(
      phone: String!
      role: String!
    ): Boolean!
    createContributionPlan(
      name: String!
      description: String
      monthlyAmount: Float!
      startDate: String!
      autoRenewEnabled: Boolean
    ): ContributionPlan!
    editContributionPlan(
      id: Int!
      name: String
      description: String
      monthlyAmount: Float
      isActive: Boolean
      autoRenewEnabled: Boolean
    ): ContributionPlan!
    joinContributionPlan(
      planId: Int!
      autoRenew: Boolean
    ): MemberPlanEnrollment!
    updateAutoRenew(
      planId: Int!
      autoRenew: Boolean!
    ): MemberPlanEnrollment!
    cancelContributionPlan(
      planId: Int!
    ): MemberPlanEnrollment!
    createContributionOrder(
      planId: Int!
    ): RazorpayOrderResponse!
    verifyContributionPayment(
      razorpay_order_id: String!
      razorpay_payment_id: String!
      razorpay_signature: String!
    ): PaymentVerificationResponse!
    sendContributionReminder(
      memberId: Int!
      type: ReminderNotificationType!
    ): Boolean!
    # ─── Multi-Location Role System Mutations ───────────────────────────────
    requestLocationAccess(
      requestedRole: Role!
      requestType: String!
      locationIds: [Int!]!
      reason: String
    ): LocationAccessRequest!
    reviewLocationAccessRequest(
      requestId: Int!
      action: String!
      rejectionReason: String
    ): LocationAccessRequest!
    assignUserLocations(
      userId: Int!
      locationIds: [Int!]!
      isPrimary: Int
    ): User!
    removeUserLocation(
      userId: Int!
      locationId: Int!
    ): Boolean!
    # Community Module Enhancements Mutations
    joinCommunityOrRequest(communityId: Int!, reason: String, inviteCode: String): String!
    reviewCommunityJoinRequest(requestId: Int!, action: String!, rejectionReason: String): Boolean!
    updateCommunityMemberRole(communityId: Int!, targetUserId: Int!, newRole: CommunityGroupRole!): Boolean!
    createCommunityComplaint(communityId: Int!, title: String!, description: String!): CommunityComplaint!
    updateComplaintStatus(complaintId: Int!, status: String!, assigneeId: Int): CommunityComplaint!
    updateCommunityNotificationPref(communityId: Int!, preference: String!): Boolean!
    banCommunityUser(communityId: Int!, userId: Int!, reason: String, durationDays: Int): Boolean!
    unbanCommunityUser(communityId: Int!, userId: Int!): Boolean!
    createCommunityAnnouncement(communityId: Int!, title: String!, message: String!, isPinned: Boolean, scheduledFor: String): CommunityAnnouncement!
    archiveCommunity(communityId: Int!, isArchived: Boolean!): Boolean!
    reportCommunityMember(communityId: Int!, reportedUserId: Int!, reason: String!): Boolean!
    # Additional Community Mutations from images
    updateCommunitySettings(communityId: Int!, settings: CommunitySettingsInput!): Community!
    generateCommunityInviteCode(communityId: Int!, expiryDays: Int): String!
    pinCommunityAnnouncement(announcementId: Int!): CommunityAnnouncement!
    unpinCommunityAnnouncement(announcementId: Int!): CommunityAnnouncement!
    updateCommunityAnnouncement(announcementId: Int!, title: String, message: String, isPinned: Boolean, scheduledFor: String): CommunityAnnouncement!
    deleteCommunityAnnouncement(announcementId: Int!): Boolean!
    bulkApproveJoinRequests(communityId: Int!, requestIds: [Int!]!): Boolean!
    starCommunityMessage(messageId: Int!): CommunityMessage!
    unstarCommunityMessage(messageId: Int!): CommunityMessage!
    uploadCommunityLinkOrDoc(communityId: Int!, title: String!, url: String!, type: String!): CommunityLinkOrDoc!
    deleteCommunityLinkOrDoc(linkOrDocId: Int!): Boolean!
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type MemberApprovalActivity {
    id: Int!
    memberName: String!
    approvedByName: String!
    location: Location!
    time: String!
    createdAt: String!
  }

  union Activity = Event | EmergencyRequest | MemberApprovalActivity

  enum ActivityType {
    EVENT
    EMERGENCY
    APPROVAL
    ROLE_CHANGE
    BROADCAST
    ADMIN
    SUB_ADMIN
    MEMBER
  }

  type RecentActivity {
    id: Int!
    activityType: ActivityType!
    title: String!
    description: String
    createdAt: String!
    member: RecentActivityMember
    location: RecentActivityLocation
    status: String
  }

  type RecentActivityMember {
    id: Int!
    name: String!
    phone: String
    role: String!
  }

  type RecentActivityLocation {
    id: Int!
    name: String!
  }

  type CommunityMemberDetail {
    id: Int!
    name: String!
    phone: String
    image: String
    role: String!
    isGroupAdmin: Boolean!
    isMuted: Boolean!
    userId: Int
    joinedAt: String
    memberSince: String
    user: User
  }

  # ============================================================
  # CONTRIBUTION MANAGEMENT SYSTEM — TYPE DEFINITIONS
  # ============================================================

  enum EnrollmentStatus {
    ACTIVE
    PAUSED
    CANCELLED
  }

  enum PaymentStatus {
    PENDING
    PAID
    FAILED
    REFUNDED
  }

  enum ContributionBadge {
    BRONZE
    SILVER
    GOLD
    PLATINUM
  }

  enum ReminderNotificationType {
    SEVEN_DAYS
    THREE_DAYS
    ONE_DAY
    OVERDUE
  }

  type ContributionPlan {
    id: Int!
    name: String!
    description: String
    monthlyAmount: Float!
    startDate: String!
    isActive: Boolean!
    autoRenewEnabled: Boolean!
    createdAt: String!
    enrolledCount: Int
  }

  type MemberPlanEnrollment {
    id: Int!
    memberId: Int!
    planId: Int!
    joinedAt: String!
    autoRenew: Boolean!
    status: EnrollmentStatus!
    plan: ContributionPlan
  }

  type ContributionPayment {
    id: Int!
    memberId: Int!
    enrollmentId: Int!
    planId: Int!
    month: Int!
    year: Int!
    amount: Float!
    status: PaymentStatus!
    paidAt: String
    razorpayOrderId: String
    razorpayPaymentId: String
    createdAt: String!
  }

  type RazorpayOrderResponse {
    orderId: String!
    amount: Float!
    currency: String!
    keyId: String!
  }

  type PaymentVerificationResponse {
    success: Boolean!
    payment: ContributionPayment
    message: String
  }

  type ReceiptDetails {
    receiptId: String!
    memberName: String!
    amount: Float!
    month: Int!
    year: Int!
    planName: String!
    paidAt: String!
    razorpayPaymentId: String
  }

  type ContributionProfile {
    memberId: Int!
    totalPaidMonths: Int!
    currentStreak: Int!
    totalContribution: Float!
    badge: ContributionBadge!
    contributionRank: Int
    member: Member
  }

  type ContributionDashboardStats {
    locationName: String!
    totalMembers: Int!
    paidMembers: Int!
    pendingMembers: Int!
    totalCollection: Float!
    monthlyTarget: Float!
    monthlyAchieved: Float!
    collectionPercentage: Float!
  }

  type MonthlyTrendPoint {
    label: String!
    amount: Float!
  }

  type LocationCollection {
    name: String!
    amount: Float!
  }

  type TopContributorItem {
    memberId: Int!
    memberName: String!
    totalContribution: Float!
    badge: ContributionBadge!
  }

  type ContributionAnalytics {
    monthlyCollectionTrend: [MonthlyTrendPoint!]!
    districtWiseCollection: [LocationCollection!]!
    constituencyWiseCollection: [LocationCollection!]!
    areaWiseCollection: [LocationCollection!]!
    paymentSuccessRate: Float!
    topContributors: [TopContributorItem!]!
    topLocations: [String!]!
  }

  type LeaderboardContributor {
    memberName: String!
    amount: Float!
    badge: ContributionBadge!
  }

  type ContributionLeaderboard {
    topContributors: [LeaderboardContributor!]!
    topDistricts: [LocationCollection!]!
    topConstituencies: [LocationCollection!]!
    topAreas: [LocationCollection!]!
    topCollectionAmount: Float!
  }

  type PendingPayment {
    memberId: Int!
    memberName: String!
    phone: String!
    location: String!
    dueAmount: Float!
    pendingMonths: Int!
  }

  enum ReportStatus {
    PENDING
    IGNORED
    WARNED
    DELETED
  }

  enum ReportAction {
    IGNORE
    WARN
    DELETE
    REMOVE_MEMBER
  }

  type PostReport {
    id: Int!
    postId: Int!
    post: Post!
    reportedById: Int!
    reportedBy: Member!
    reason: String!
    status: ReportStatus!
    createdAt: String!
  }

  type CommunityPostReport {
    id: Int!
    postId: Int!
    post: CommunityPost!
    reportedById: Int!
    reportedBy: Member!
    reason: String!
    status: ReportStatus!
    createdAt: String!
  }

  type UserWarning {
    id: Int!
    memberId: Int!
    member: Member!
    adminId: Int!
    admin: User!
    message: String!
    postId: Int
    communityPostId: Int
    createdAt: String!
  }

  # ─── Multi-Location Role System ────────────────────────────────────────────

  type UserLocationAssignment {
    id: Int!
    userId: Int!
    locationId: Int!
    isPrimary: Boolean!
    location: Location!
    createdAt: String!
  }

  type LocationAccessRequest {
    id: Int!
    userId: Int!
    currentRole: Role!
    requestedRole: Role!
    requestType: String!
    status: String!
    reason: String
    rejectionReason: String
    createdAt: String!
    updatedAt: String!
    user: User!
    approvedBy: User
    requestedLocations: [RequestLocationItem!]!
  }

  type RequestLocationItem {
    id: Int!
    requestId: Int!
    locationId: Int!
    location: Location!
  }

  enum CommunityGroupRole {
    OWNER
    ADMIN
    MODERATOR
    MEMBER
  }

  enum CommunityPrivacyType {
    PUBLIC
    PRIVATE
    SECRET
  }

  type CommunityJoinRequest {
    id: Int!
    communityId: Int!
    userId: Int!
    status: String!
    reason: String
    user: User!
    createdAt: String!
  }

  type CommunityAdminLog {
    id: Int!
    action: String!
    details: String!
    admin: User!
    createdAt: String!
  }

  type CommunityComplaint {
    id: Int!
    title: String!
    description: String!
    status: String!
    reporter: User!
    assignee: User
    createdAt: String!
  }

  type CommunityBanInfo {
    id: Int!
    userId: Int!
    reason: String
    user: User!
    bannedBy: User!
    createdAt: String!
  }

  type CommunityAnnouncement {
    id: Int!
    title: String!
    message: String!
    createdAt: String!
    scheduledFor: String
    isPinned: Boolean!
  }

  type CommunityMediaItem {
    messageId: Int!
    mediaUrl: String!
    mediaType: String!
    fileName: String
    createdAt: String!
  }

  type CommunityAnalytics {
    totalMembers: Int!
    activeMembersCount: Int!
    pendingJoinRequestsCount: Int!
    newMembersThisWeek: Int!
    eventsCreatedCount: Int!
    pollParticipationRate: Float!
    complaintResolutionRate: Float!
  }

  type CommunitySettings {
    communityId: Int!
    notificationsEnabled: Boolean!
    mediaAutoDownload: Boolean!
    linksAndDocsEnabled: Boolean!
    muted: Boolean!
    starredMessagesEnabled: Boolean!
    about: String!
    location: String!
    createdAt: String!
  }

  type CommunityRolePermission {
    roleName: CommunityGroupRole!
    permissions: [String!]!
    description: String!
  }

  type CommunityLinkOrDoc {
    id: Int!
    title: String!
    url: String!
    type: String!
    uploadedBy: String!
    uploadedAt: String!
  }

  input CommunitySettingsInput {
    name: String
    description: String
    location: String
    privacyType: CommunityPrivacyType
    allowMemberMessages: Boolean
    notificationsEnabled: Boolean
    mediaAutoDownload: Boolean
    linksAndDocsEnabled: Boolean
    muted: Boolean
    starredMessagesEnabled: Boolean
  }
`;
