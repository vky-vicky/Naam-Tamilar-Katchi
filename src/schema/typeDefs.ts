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
    phone: String # Redacted for restricted roles
    bloodGroup: String
    role: String!
    profession: String
    location: Location!
    isActive: Boolean!
    approvalStatus: ApprovalStatus!
    createdAt: String!
    activityHistory: [Activity!]!
  }

  type User {
    id: Int!
    name: String!
    phone: String!
    role: UserRole!
    approvalStatus: ApprovalStatus!
    location: Location
    isActive: Boolean!
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

  union Activity = Event | EmergencyRequest

  type Query {
    me: User
    getLocationList(parentId: Int, type: LocationType): [Location!]!
    getLocationDetails(id: Int!): Location
    getMemberList(locationId: Int, professionName: String, bloodGroup: String, search: String, limit: Int, offset: Int, approvalStatus: ApprovalStatus): [Member!]!
    getMemberDetails(id: Int!): Member
    dashboardStats(locationId: Int): DashboardStats!
    recentActivity(locationId: Int, limit: Int): [Activity!]!
    professions: [Profession!]!
    communityFeed(locationId: Int): [Post!]!
    notifications(locationId: Int): [Notification!]!
    getUserList(locationId: Int, role: UserRole): [User!]!
  }

  type Mutation {
    # Unified Login with Role Selection (Figma Flow)
    adminLogin(
      phone: String!
      password: String!
      role: String           # "Super Admin", "Admin", "Sub Admin", or "Member"
    ): AuthResponse!


    # User & Member Creation (Figma Flow)
    createUser(
      name: String!
      phone: String!
      password: String!
      role: UserRole!
      locationId: Int!     # This will be District ID for Admin, Area ID for Sub Admin
    ): User!

    addMember(
      name: String!
      phone: String!
      password: String!
      locationId: Int!
      bloodGroup: String
      professionName: String   # User can type their profession directly
    ): Member!
    
    updateMember(
      id: Int!, 
      name: String, 
      phone: String, 
      bloodGroup: String, 
      role: String,
      professionName: String, 
      locationId: Int
    ): Member!
    
    updateMemberStatus(id: Int!, status: ApprovalStatus!): Member!
    
    # Events & Requests
    createEvent(title: String!, description: String, date: String!, locationId: Int!): Event!
    respondToEvent(eventId: Int!, memberId: Int!, status: RSVPStatus!): EventResponse!
    
    createEmergencyRequest(title: String!, description: String, type: RequestType!, locationId: Int!, audience: String): EmergencyRequest!
    updateRequestStatus(id: Int!, status: RequestStatus!): EmergencyRequest!

    # Community & Notifications
    createPost(content: String!, image: String, authorName: String!, authorRole: String, locationId: Int!): Post!
    createNotification(title: String!, message: String!, type: String!, time: String, locationId: Int!): Notification!


  }
`;


