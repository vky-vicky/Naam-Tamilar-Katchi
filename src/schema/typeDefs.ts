import { gql } from 'graphql-tag';

export const typeDefs = gql`
  enum LocationType {
    STATE
    DISTRICT
    TALUK
    AREA
    STREET
  }

  enum EventStatus {
    ACTIVE
    COMPLETED
    CANCELLED
  }

  enum RequestType {
    EMERGENCY
    NORMAL
  }

  enum RequestStatus {
    PENDING
    IN_PROGRESS
    COMPLETED
  }

  enum RSVPStatus {
    GOING
    MAYBE
    NOT_GOING
  }

  enum UserRole {
    SUPER_ADMIN
    ADMIN
    SUB_ADMIN
    MEMBER
  }

  enum ApprovalStatus {
    PENDING
    APPROVED
    REJECTED
    SUSPENDED
  }

  enum CampaignStatus {
    DRAFT
    SENT
    FAILED
  }


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

  type Profession {
    id: Int!
    name: String!
    createdAt: String!
  }

  type Member {
    id: Int!
    name: String!
    surname: String
    phone: String # Redacted for restricted roles
    bloodGroup: String
    role: String!
    profession: String
    location: Location!
    isActive: Boolean!
    approvalStatus: ApprovalStatus!
    createdAt: String!
    activityHistory: [Activity!]!
    allergies: String
    conditions: String
    emergencyContact: String
    createdBy: User
    addedBy: String
    image: String
  }

  type User {
    id: Int!
    name: String!
    surname: String
    phone: String!
    role: UserRole!
    approvalStatus: ApprovalStatus!
    location: Location
    isActive: Boolean!
    addedBy: String
    image: String
  }

  type Campaign {
    id: Int!
    title: String!
    message: String!
    status: CampaignStatus!
    createdBy: User!
    targets: [CampaignTarget!]!
    createdAt: String!
  }

  type CampaignTarget {
    id: Int!
    location: Location!
  }


  type AuthResponse {
    token: String
    user: User
    error: String
  }

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

  type Event {
    id: Int!
    title: String!
    description: String
    date: String!
    location: Location!
    status: EventStatus!
    createdBy: User!
    createdAt: String!
    responses: [EventResponse!]!
    stats: EventStats!
  }

  type EventResponse {
    id: Int!
    member: Member!
    status: RSVPStatus!
    createdAt: String!
  }

  type EventStats {
    going: Int!
    maybe: Int!
    notGoing: Int!
  }

  type EmergencyRequest {
    id: Int!
    title: String!
    description: String
    type: RequestType!
    status: RequestStatus!
    location: Location!
    member: Member
    createdBy: User
    audience: String
    createdAt: String!
  }

  type Post {
    id: Int!
    content: String!
    image: String
    authorName: String!
    authorRole: String
    likes: Int!
    comments: [Comment!]!
    commentCount: Int!
    createdAt: String!
  }

  type Comment {
    id: Int!
    content: String!
    authorName: String!
    authorRole: String
    postId: Int!
    createdAt: String!
  }

  type Notification {
    id: Int!
    title: String!
    message: String!
    type: String!
    time: String
    createdAt: String!
  }

  type Broadcast {
    id: Int!
    title: String!
    message: String!
    image: String
    scope: LocationType!
    location: Location!
    createdBy: User!
    isActive: Boolean!
    recipientCount: Int!
    createdAt: String!
  }

  type TargetableLocation {
    id: Int!
    name: String!
    type: LocationType!
    memberCount: Int!
  }

  type MemberApprovalActivity {
    id: Int!
    memberName: String!
    approvedByName: String!
    time: String!
  }

  union Activity = Event | EmergencyRequest | MemberApprovalActivity

  type Query {
  # Existing queries ...
  getTargetableGroups: [Community!]!
  getCommunityFeed(locationId: Int): [CommunityPost!]!

    me: User
    getLocationList(parentId: Int, type: LocationType): [Location!]!
    getLocationDetails(id: Int!): Location
    getMemberList(locationId: Int, professionName: String, bloodGroup: String, search: String, limit: Int, offset: Int, approvalStatus: ApprovalStatus): [Member!]!
    getMemberDetails(id: Int!): Member
    dashboardStats(locationId: Int): DashboardStats!
    recentActivity(locationId: Int, limit: Int): [Activity!]!
    professions: [Profession!]!
    communityFeed(locationId: Int): [CommunityPost!]!
    notifications(locationId: Int): [Notification!]!
    getUserList(locationId: Int, role: UserRole): [User!]!
    getEventList(locationId: Int, status: EventStatus): [Event!]!
    getEmergencyRequestList(locationId: Int, status: RequestStatus): [EmergencyRequest!]!
    getCommunities: [Community!]!
    getCommunityPosts(communityId: Int!): [CommunityPost!]!
    getBroadcasts(locationId: Int, scope: LocationType): [Broadcast!]!
    getTargetableLocations: [TargetableLocation!]!
  }

  type Mutation {
    # Login — just phone + password, role auto-detected from DB
    adminLogin(
      phone: String!
      password: String!
    ): AuthResponse!


    # User & Member Creation (Figma Flow)
    createUser(
      name: String!
      surname: String
      phone: String!
      password: String!
      role: UserRole!
      locationId: Int
      districtId: Int
      talukId: Int
      areaId: Int
      streetId: Int
      bloodGroup: String
      professionName: String
      image: String
    ): User!

    addMember(
      name: String!
      surname: String
      phone: String!
      password: String!
      locationId: Int
      districtId: Int
      talukId: Int
      areaId: Int
      streetId: Int
      bloodGroup: String
      professionName: String   # User can type their profession directly
      image: String
    ): Member!
    
    updateMember(
      id: Int!, 
      name: String, 
      surname: String,
      phone: String, 
      bloodGroup: String, 
      role: String,
      professionName: String, 
      locationId: Int,
      image: String
    ): Member!
    
    updateMemberStatus(id: Int!, status: ApprovalStatus!): Member!
    
    # Events, Campaigns & Requests
    createEvent(title: String!, description: String, date: String!, locationId: Int!, professionNames: [String!]): Event!
    createCampaign(title: String!, message: String!, locationId: Int!, professionNames: [String!]): Campaign!
    recallEvent(id: Int!): Boolean!
    recallCampaign(id: Int!): Boolean!
    respondToEvent(eventId: Int!, memberId: Int!, status: RSVPStatus!): EventResponse!
    
    createEmergencyRequest(title: String!, description: String, type: RequestType!, locationId: Int!, audience: String): EmergencyRequest!
    updateRequestStatus(id: Int!, status: RequestStatus!): EmergencyRequest!

    # Community & Notifications
    createPost(content: String!, image: String, authorName: String!, authorRole: String, locationId: Int!): Post!
    likePost(id: Int!): Post!
    addComment(postId: Int!, content: String!, authorName: String!, authorRole: String): Comment!
    createNotification(title: String!, message: String!, type: String!, time: String, locationId: Int!): Notification!
    updateFcmToken(token: String!): Boolean!

    # Communities Mutations
    createCommunity(name: String!, description: String, image: String, role: UserRole, locationId: Int): Community!
    joinCommunity(communityId: Int!, memberId: Int!): Boolean!
    createCommunityPost(communityId: Int!, title: String!, content: String!, image: String): CommunityPost!
    likeCommunityPost(postId: Int!): CommunityPost!
    addCommunityComment(postId: Int!, content: String!): CommunityComment!
    changeUserRole(phone: String!, role: String!): Boolean!
    updateProfileImage(image: String!): Boolean!

    # Broadcasts
    createBroadcast(
      title: String!
      message: String!
      image: String
      locationId: Int!
    ): Broadcast!
    recallBroadcast(id: Int!): Boolean!
  }

  type Community {
    id: Int!
    name: String!
    description: String
    image: String
    role: UserRole
    location: Location
    memberCount: Int!
    createdAt: String!
  }

  type CommunityPost {
    id: Int!
    title: String!
    content: String!
    image: String
    community: Community!
    createdBy: User!
    likes: Int!
    comments: [CommunityComment!]!
    createdAt: String!
  }

  type CommunityComment {
    id: Int!
    content: String!
    authorName: String!
    authorRole: String
    postId: Int!
    createdAt: String!
  }
`;


