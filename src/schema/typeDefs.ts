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
    CANDIDATE
    CAPTAIN
    MEMBER
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
    allergies: String
    conditions: String
    emergencyContact: String
    role: String!
    professionId: Int
    profession: Profession
    location: Location!
    isActive: Boolean!
    createdAt: String!
    activityHistory: [Activity!]!
  }

  type User {
    id: Int!
    name: String!
    phone: String!
    role: UserRole!
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
    totalMembers: Int!
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
    locations(parentId: Int, type: LocationType): [Location!]!
    location(id: Int!): Location
    members(locationId: Int, professionId: Int, bloodGroup: String, search: String, limit: Int, offset: Int): [Member!]!
    member(id: Int!): Member
    dashboardStats(locationId: Int): DashboardStats!
    recentActivity(locationId: Int, limit: Int): [Activity!]!
    professions: [Profession!]!
    communityFeed(locationId: Int): [Post!]!
    notifications(locationId: Int): [Notification!]!
  }

  type Mutation {
    # Auth & Login (Figma Flow)
    adminLogin(
      name: String!
      role: String!           # "Super Admin", "Admin", or "Sub Admin"
      state: String           # For Super Admin (Thalaivar)
      district: String        # For Admin & Sub Admin
      constituency: String    # For Admin & Sub Admin
      town: String            # For Sub Admin (Ooru Thalaivar)
      password: String!
    ): AuthResponse!


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
      bloodGroup: String,
      allergies: String,
      conditions: String,
      emergencyContact: String,
      role: String
    ): Member!
    
    updateMember(
      id: Int!, 
      name: String, 
      phone: String, 
      bloodGroup: String, 
      allergies: String,
      conditions: String,
      emergencyContact: String,
      role: String,
      professionId: Int, 
      locationId: Int
    ): Member!
    
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


