# Naam Tamilar Katchi - Political CRM Backend

This is a high-performance, hierarchical CRM backend built with **Node.js, TypeScript, Apollo Server (GraphQL), and Prisma (PostgreSQL)**.

## 🚀 Getting Started

1. **Install Dependencies**: `npm install`
2. **Setup Database**: 
   - Update `DATABASE_URL` in `.env`.
   - Sync schema: `npx prisma db push`
   - Seed data: `npx prisma db seed`
3. **Start Development**: `npm run dev` (API runs at `http://localhost:4000/graphql`)

---

## 🏛️ Location Hierarchy
The system uses a recursive structure to manage locations:
**State ➔ District ➔ Taluk ➔ Area ➔ Street**

- Every member is linked to a `Location`.
- The `memberCount` field in the `Location` query automatically calculates total members across all nested sub-locations.

---

## 🔐 Role-Based Access Control (RBAC)
Data visibility is strictly enforced based on the user's role and assigned `locationId`:

- **SUPER_ADMIN (Leader)**: Full access to all state-wide data.
- **CANDIDATE**: Access limited to members within their assigned District/Taluk.
- **CAPTAIN**: Access limited to their assigned Area/Street.
- **MEMBER**: Basic profile access only.

**Privacy Rule**: Phone numbers of members are **redacted (null)** if the requesting user does not have administrative authority over that member's location.

---

## 📡 Key API Endpoints (GraphQL)

### Queries
- `me`: Get current logged-in user details.
- `locations(parentId, type)`: Fetch hierarchical locations.
- `members(locationId, profession)`: Filter members by location/profession (supports RBAC filtering).
- `dashboardStats`: High-level summary (Total members, active campaigns, etc.).

### Mutations
- `requestOTP(phone)`: Start login flow.
- `verifyOTP(phone, otp)`: Complete login and get JWT.
- `addMember(...)`: Onboard a new member.
- `createCampaign(...)`: Create a targeted messaging campaign for specific locations.

---

## 🛠️ Tech Stack
- **API**: GraphQL (Apollo Server)
- **Database**: PostgreSQL (via Prisma)
- **Logic**: TypeScript
- **Auth**: OTP + JWT
- **Drivers**: @prisma/adapter-pg (Prisma 7 Standard)

---

## 📧 Handover Support
Refer to `src/schema/typeDefs.ts` for the full GraphQL schema definitions.
