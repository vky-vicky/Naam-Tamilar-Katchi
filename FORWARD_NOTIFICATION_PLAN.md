# Forward to Other Taluks - Implementation Plan

## Overview
District Incharge can forward events/broadcasts/emergencies to specific taluks within their assigned districts.

## Frontend UI Flow

### Step 1: District Incharge View
When District Incharge sees an event/broadcast/emergency, show a "Forward" button.

### Step 2: Forward Modal
When clicking "Forward", show a modal with:
- Title: "Forward to Taluks"
- List of taluks within the district (checkboxes)
  - Example: [x] Vedaranyam, [ ] Nagapattinam, [ ] Kilvelur
- "Forward" button

### Step 3: API Call
When user clicks "Forward", call:
```graphql
mutation ForwardNotification($entityId: Int!, $targetLocationIds: [Int!]!, $type: String!) {
  forwardNotification(entityId: $entityId, targetLocationIds: $targetLocationIds, type: $type)
}
```

**Parameters:**
- `entityId`: The ID of the event/broadcast/emergency being forwarded
- `targetLocationIds`: Array of location IDs to forward to (taluk IDs)
- `type`: "EVENT", "BROADCAST", or "EMERGENCY"

## Backend API

### GraphQL Schema (typeDefs.ts)
Add to Mutation type:
```graphql
forwardNotification(
  entityId: Int!
  targetLocationIds: [Int!]!
  type: String!  # "EVENT", "BROADCAST", "EMERGENCY"
): Boolean!
```

### Backend Logic (resolvers.ts)

```typescript
forwardNotification: async (_: any, { entityId, targetLocationIds, type }: any, context: any) => {
  if (!context?.user) {
    throw new Error(I18nService.translate("unauthorized_login", context?.language));
  }

  const role = context.user.role;
  if (role !== 'DISTRICT_INCHARGE' && role !== 'ADMIN' && role !== 'SUPER_ADMIN') {
    throw new Error('Only DISTRICT_INCHARGE, ADMIN, or SUPER_ADMIN can forward notifications');
  }

  let originalEntity: any = null;
  let originalLocationId: number = 0;
  let title: string = '';
  let message: string = '';

  // Fetch original entity based on type
  if (type === 'EVENT') {
    originalEntity = await (prisma as any).event.findUnique({
      where: { id: Number(entityId) },
      include: { location: true }
    });
    if (!originalEntity) throw new Error('Event not found');
    originalLocationId = originalEntity.locationId;
    title = `Forwarded Event: ${originalEntity.title}`;
    message = originalEntity.description || 'Event forwarded';
  } else if (type === 'BROADCAST') {
    originalEntity = await (prisma as any).broadcast.findUnique({
      where: { id: Number(entityId) },
      include: { location: true }
    });
    if (!originalEntity) throw new Error('Broadcast not found');
    originalLocationId = originalEntity.locationId;
    title = `Forwarded Broadcast: ${originalEntity.title}`;
    message = originalEntity.message || 'Broadcast forwarded';
  } else if (type === 'EMERGENCY') {
    originalEntity = await (prisma as any).emergencyRequest.findUnique({
      where: { id: Number(entityId) },
      include: { location: true }
    });
    if (!originalEntity) throw new Error('Emergency request not found');
    originalLocationId = originalEntity.locationId;
    title = `Forwarded Emergency: ${originalEntity.title}`;
    message = originalEntity.description || 'Emergency forwarded';
  } else {
    throw new Error('Invalid type. Must be EVENT, BROADCAST, or EMERGENCY');
  }

  // Validate user can forward this entity
  if (role === 'DISTRICT_INCHARGE') {
    const userLocations = await (prisma as any).userLocation.findMany({
      where: { userId: context.user.id },
      select: { locationId: true }
    });

    const districtIds: number[] = [];
    for (const ul of userLocations) {
      const location = await (prisma as any).location.findUnique({
        where: { id: ul.locationId }
      });
      if (location && location.type === 'DISTRICT') {
        districtIds.push(location.id);
      }
    }

    // Check if original entity location is within user's districts
    const ancestorIds = await getAncestorLocationIds(originalLocationId);
    const isInDistrict = ancestorIds.some(id => districtIds.includes(id));

    if (!isInDistrict) {
      throw new Error('You can only forward notifications within your assigned districts');
    }
  }

  // Create new notifications for each target location
  for (const targetLocId of targetLocationIds) {
    await sendSystemNotification({
      title,
      message,
      type,
      locationId: Number(targetLocId),
      createdById: context.user.id,
      purpose: `Forwarded from location ${originalLocationId}`,
      entityType: type,
      entityId: entityId,
      metadata: {
        forwardedFrom: originalLocationId,
        forwardedBy: context.user.id,
        originalEntityId: entityId
      }
    });
  }

  return true;
}
```

## Database Changes Required

### Notification Model (schema.prisma)
Add fields to track forwarded notifications:
```prisma
model Notification {
  // ... existing fields
  forwardedFrom  Int?
  forwardedBy    Int?
  originalNotificationId Int?
  
  // Optional: Add relations
  forwardedFromLocation  Location?  @relation("ForwardedFrom", fields: [forwardedFrom], references: [id])
  forwardedByUser         User?      @relation("ForwardedBy", fields: [forwardedBy], references: [id])
  originalNotification    Notification? @relation("OriginalForwarded", fields: [originalNotificationId], references: [id])
}
```

## Implementation Steps

1. **Backend - Add Schema**
   - Add `forwardNotification` mutation to typeDefs.ts
   - Add fields to Notification model in schema.prisma
   - Run `npx prisma migrate dev`

2. **Backend - Add Resolver**
   - Implement `forwardNotification` resolver in resolvers.ts
   - Add validation for District Incharge jurisdiction
   - Add logging for debugging

3. **Frontend - Add UI**
   - Add "Forward" button to event/broadcast/emergency cards
   - Create forward modal with taluk checkboxes
   - Implement API call to `forwardNotification`

4. **Testing**
   - Test forwarding from District Incharge account
   - Verify notifications appear in target taluks
   - Verify FCM notifications sent to target locations

## Example Use Case

**Scenario:** Vedaranyam admin creates an event

1. District Incharge (9000000004) sees the event
2. Clicks "Forward" button
3. Modal shows taluks: [x] Vedaranyam, [x] Nagapattinam, [ ] Kilvelur
4. Clicks "Forward"
5. Backend creates new notifications for Vedaranyam and Nagapattinam
6. Users in those taluks receive push notifications
7. Notifications appear in their notification list

## Notes

- Original entity (Event/Broadcast/Emergency) remains unchanged
- Forwarded notifications have metadata showing who forwarded and from where
- Only users with appropriate roles can forward
- District Incharge can only forward within their assigned districts
- Uses entityId instead of notificationId to support forwarding from entity cards
