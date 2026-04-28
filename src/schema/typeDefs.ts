import { gql } from 'graphql-tag';

export const typeDefs = gql`
  enum LocationType {
    STATE
    DISTRICT
    TALUK
    AREA
    STREET
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
  }

  type Member {
    id: Int!
    name: String!
    phone: String # Redacted for restricted roles
    profession: String
    location: Location!
    isActive: Boolean!
    createdAt: String!
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
  }

  type Query {
    me: User
    locations(parentId: Int, type: LocationType): [Location!]!
    location(id: Int!): Location
    members(locationId: Int, profession: String, limit: Int, offset: Int): [Member!]!
    member(id: Int!): Member
    campaigns: [Campaign!]!
    campaign(id: Int!): Campaign
    dashboardStats: DashboardStats!
    totalLocations(type: LocationType!): Int!
    searchLocations(type: LocationType!, search: String): [Location!]!
  }

  type Mutation {
    # Auth
    requestOTP(phone: String!): Boolean!
    verifyOTP(phone: String!, otp: String!): AuthResponse!

    # Members
    addMember(name: String!, phone: String!, locationId: Int!, profession: String): Member!
    updateMember(id: Int!, isActive: Boolean, locationId: Int): Member!

    # Campaigns
    createCampaign(title: String!, message: String!, targetLocationIds: [Int!]!): Campaign!
    sendCampaign(id: Int!): Boolean!
  }
`;


