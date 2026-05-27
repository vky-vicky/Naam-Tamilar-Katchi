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
  }

  enum RequestStatus {
    PENDING
    RESOLVED
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
    type: LocationType!
    parentId: Int
    parent: Location
    children: [Location!]!
    memberCount: Int!
    childCount: Int!
    events: [Event!]!
    requests: [EmergencyRequest!]!
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
    role: Role!
    phone: String
    image: String
    location: Location
    addedBy: String!
  }

  type Profession {
    id: Int!
    name: String!
  }

  type Member {
    id: Int!
    name: String!
    phone: String
    location: Location!
    profession: Profession
    approvalStatus: ApprovalStatus!
    approvedBy: User
    createdAt: String!
    activityHistory: [Activity!]!
    createdBy: User
    addedBy: String!
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
    createdAt: String!
  }

  type Broadcast {
    id: Int!
    title: String!
    message: String!
    image: String
    location: Location!
    scope: BroadcastScope!
    createdBy: User!
    createdAt: String!
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
    createdAt: String!
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
  }

  type CommunityPost {
    id: Int!
    title: String!
    content: String!
    image: String
    likes: Int!
    community: Community!
    createdBy: User!
    comments: [Comment!]!
    createdAt: String!
  }

  type Notification {
    id: Int!
    title: String!
    message: String!
    type: String!
    locationId: Int!
    location: Location
    createdAt: String!
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
    image: String
    authorName: String!
    authorRole: String!
    locationId: Int!
    likes: Int!
    comments: [Comment!]!
    commentCount: Int!
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
    totalAdmins: Int!
    totalSubAdmins: Int!
    totalMembers: Int!
    pendingApprovals: Int!
    totalStreets: Int!
    activeEvents: Int!
    emergencyRequests: Int!
  }

  type Query {
    getLocationList(parentId: Int, type: LocationType): [Location!]!
    getLocationDetails(id: Int!): Location
    getFullLocationTree(constituencyId: Int!): LocationNode!
    getTownsAndStreets(constituencyId: Int!): [TownWithStreets!]!
    me: User
    getMemberList(locationId: Int, professionName: String, bloodGroup: String, search: String, limit: Int, offset: Int, approvalStatus: ApprovalStatus): [Member!]!
    getMemberDetails(id: Int!): Member
    recentActivity(locationId: Int, limit: Int = 10): [Activity!]!
    professions: [Profession!]!
    communityFeed(locationId: Int): [CommunityPost!]!
    notifications(locationId: Int): [Notification!]!
    getUserList(locationId: Int, role: Role): [User!]!
    getEventList(locationId: Int, status: EventStatus): [Event!]!
    getEmergencyRequestList(locationId: Int, status: RequestStatus): [EmergencyRequest!]!
    getCommunities: [Community!]!
    getCommunityPosts(communityId: Int!): [CommunityPost!]!
    getCommunityMessages(communityId: Int!, limit: Int = 50, beforeMessageId: Int): [CommunityMessage!]!
    getCommunityUnreadCount(communityId: Int!): Int!
    getTargetableLocations(parentId: Int): [Location!]!
    getBroadcasts(locationId: Int, scope: BroadcastScope): [Broadcast!]!
    pendingMembers(locationId: Int): [Member!]!
    bloodGroups: [String!]!
    dashboardStats(locationId: Int): DashboardStats!
  }

  type Mutation {
    # Mutations are defined in resolvers; placeholders added for schema validity.
    adminLogin(phone: String!, password: String!): AuthPayload
    createUser(name: String!, phone: String!, role: Role!, locationId: Int, professionName: String): User
    addMember(name: String!, phone: String!, professionName: String, locationId: Int): Member
    updateMemberStatus(id: Int!, status: ApprovalStatus!): Member
    updateMember(id: Int!, name: String, phone: String, professionName: String): Member
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
    respondToEvent(
      eventId: Int!
      memberId: Int!
      status: String!
    ): EventResponse!
    createEmergencyRequest(
      title: String!
      description: String
      type: String!
      locationId: Int!
      audience: String
    ): EmergencyRequest!
    updateRequestStatus(
      id: Int!
      status: RequestStatus!
    ): EmergencyRequest!
    createPost(
      content: String!
      image: String
      authorName: String!
      authorRole: String!
      locationId: Int!
    ): Post!
    likePost(id: Int!): Post!
    addComment(
      postId: Int!
      content: String!
      authorName: String!
      authorRole: String!
    ): Comment!
    createNotification(
      title: String!
      message: String!
      type: String!
      locationId: Int!
    ): Notification!
    updateFcmToken(token: String!): Boolean!
    createCommunity(
      name: String!
      description: String
      image: String
      allowMemberMessages: Boolean
    ): Community!
    joinCommunity(
      communityId: Int!
      memberId: Int!
    ): Boolean!
    createCommunityPost(
      communityId: Int!
      title: String!
      content: String!
      image: String
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
  }

  type AuthPayload {
    token: String!
    user: User!
  }

  type MemberApprovalActivity {
    id: Int!
    memberName: String!
    approvedByName: String!
    time: String!
    createdAt: String!
  }

  union Activity = Event | EmergencyRequest | MemberApprovalActivity
`;
