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
    CANDIDATE
    CAPTAIN
    MEMBER
  }

  enum CampaignStatus {
    DRAFT
    SENT
    FAILED
  }

  enum MessageStatus {
    PENDING
    SENT
    DELIVERED
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
    phone: String # Redacted for restricted roles
    bloodGroup: String
    professionId: Int
    profession: Profession
    location: Location!
    isActive: Boolean!
    createdAt: String!
    history: [Activity!]!
  }

  type User {
    id: Int!
    name: String!
    phone: String!
    role: UserRole!
    location: Location
    isActive: Boolean!
  }

  type Campaign {
    id: Int!
    title: String!
    message: String!
    status: CampaignStatus!
    createdBy: User!
    targets: [Location!]!
    sentCount: Int!
    failedCount: Int!
    createdAt: String!
  }

  type MessageLog {
    id: Int!
    campaign: Campaign!
    member: Member!
    status: MessageStatus!
    errorMessage: String
    sentAt: String
  }

  type AuthResponse {
    token: String
    user: User
    error: String
  }

  type DashboardStats {
    totalMembers: Int!
    totalUsers: Int!
    totalCampaigns: Int!
    activeCampaigns: Int!
    newToday: Int!
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

  union Activity = Event | EmergencyRequest

  type Query {
    me: User
    locations(parentId: Int, type: LocationType): [Location!]!
    location(id: Int!): Location
    members(locationId: Int, professionId: Int, bloodGroup: String, search: String, limit: Int, offset: Int): [Member!]!
    member(id: Int!): Member
    campaigns: [Campaign!]!
    campaign(id: Int!): Campaign
    dashboardStats(locationId: Int): DashboardStats!
    recentActivity(locationId: Int, limit: Int): [Activity!]!
    totalLocations(type: LocationType!): Int!
    searchLocations(type: LocationType!, search: String): [Location!]!
    professions: [Profession!]!
  }

  type Mutation {
    # Auth
    requestOTP(phone: String!): Boolean!
    verifyOTP(phone: String!, otp: String!): AuthResponse!
    login(phone: String!, password: String!): User!
    loginWithPassword(phone: String, password: String!, locationId: Int): User!

    # Members
    addMember(
      name: String!, 
      phone: String!, 
      locationId: Int, 
      district: String, 
      constituency: String, 
      town: String, 
      street: String, 
      professionId: Int, 
      bloodGroup: String
    ): Member!
    
    updateMember(id: Int!, name: String, phone: String, bloodGroup: String, professionId: Int, locationId: Int): Member!
    
    # Events & Requests
    createEvent(title: String!, description: String, date: String!, locationId: Int!): Event!
    respondToEvent(eventId: Int!, memberId: Int!, status: RSVPStatus!): EventResponse!
    
    createEmergencyRequest(title: String!, description: String, type: RequestType!, locationId: Int!, audience: String): EmergencyRequest!
    updateRequestStatus(id: Int!, status: RequestStatus!): EmergencyRequest!

    # Admin
    createUser(
      name: String!, 
      phone: String!, 
      password: String!, 
      role: UserRole!, 
      district: String, 
      constituency: String, 
      town: String
    ): User!
    
    createCampaign(title: String!, message: String!, targetLocationIds: [Int!]!): Campaign!
  }
`;


