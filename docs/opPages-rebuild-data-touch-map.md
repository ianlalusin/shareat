# Rebuild OpPages - Data Touch Map & Permissions Analysis

This document outlines the data access patterns, roles, and security rule interactions for the "Rebuild OpPages (Projections)" tool to diagnose a "Missing or insufficient permissions" error.

## 1. Call Chain

The user action of clicking the "Rescan & Rebuild Ops Projections" button triggers the following sequence:

1.  **UI Component**: `src/app/manager/data-management/page.tsx`
    *   The `DataManagementPage` component renders the button.
    *   The `onClick` event triggers the `handleRebuildOps` function.
2.  **Client-Side Logic**: `src/lib/ops/rebuild-op-pages.ts`
    *   `handleRebuildOps` calls the `rebuildOpPagesForRange` function.
    *   This function contains all the Firestore read, write, and delete operations for the rebuild process.

## 2. Firestore Data Touch Map

The `rebuildOpPagesForRange` function performs the following operations in sequence:

| Op ID                      | Firestore Path Pattern                                          | R/W/D  | Fields/Filters                               | Purpose                                                              |
| :------------------------- | :-------------------------------------------------------------- | :----- | :------------------------------------------- | :------------------------------------------------------------------- |
| **READ-STATIONS**          | `stores/{storeId}/kitchenLocations`                             | Query  | `where("isActive", "==", true)`              | Get a list of all active kitchen station IDs for the store.          |
| **DELETE-STALE-TICKETS**   | `stores/{storeId}/opPages/{stationId}/activeKdsTickets`         | Delete | *(all docs in collection)*                   | **Cleanup**: Clear old ticket projections for each station.          |
| **DELETE-STALE-SESSIONS**  | `stores/{storeId}/opPages/sessionPage/activeSessions`           | Delete | *(all docs in collection)*                   | **Cleanup**: Clear old active session projections.                   |
| **READ-SESSIONS**          | `stores/{storeId}/sessions`                                     | Query  | `where("startedAt")`, `orderBy("startedAt")` | Get all source-of-truth session documents within the date range.     |
| **READ-TICKETS**           | `kitchentickets` (Collection Group)                             | Query  | `where("storeId")`, `where("createdAt")`     | Get all source-of-truth kitchen tickets for the store in the range.  |
| **WRITE-SESSION-PROJ**     | `stores/{storeId}/opPages/sessionPage/activeSessions/{sessionId}` | Set    | *(entire document)*                          | **Rebuild**: Create new projections for currently active sessions.   |
| **WRITE-TICKET-PROJ**      | `stores/{storeId}/opPages/{stationId}/activeKdsTickets/{ticketId}`  | Set    | *(entire document)*                          | **Rebuild**: Create new projections for currently preparing tickets. |
| **WRITE-HISTORY-PREVIEW**  | `stores/{storeId}/opPages/{stationId}/historyPreview/current`     | Set    | `items`, `updatedAt`                         | **Rebuild**: Update the recent history preview for the KDS view.     |
| **WRITE-STATION-SUMMARY**  | `stores/{storeId}/opPages/{stationId}`                          | Update | `activeCount`, `today...`                    | **Rebuild**: Update the summary counts for each kitchen station.     |
| **WRITE-SESSION-SUMMARY**  | `stores/{storeId}/opPages/sessionPage`                          | Update | `activeSessionCount`, `activeGuestCount`     | **Rebuild**: Update the summary counts for the main sessions page.   |

## 3. Required Roles & Claims

-   **Execution Prerequisite**: The UI for this tool is protected by `<RoleGuard allow={["admin", "manager"]}>`, meaning only users with the `admin` or `manager` role can see and use it.
-   **Store Scoping**: All operations are correctly scoped to the `activeStore.id` provided from the context.
-   **Rules Context**: The security rules rely on the `hasStoreAccess(storeId)` function, which checks if the user's `staff` document (`/staff/{uid}`) contains the target `storeId` in its `assignedStoreIds` array or if the user has the `admin` role.

## 4. Rule Coverage Matrix & Failure Point

The primary security rule governing these operations is:

```rules
// From: firestore.rules

// This rule governs all paths under /stores/{storeId}/opPages/
match /stores/{storeId}/opPages/{docPath=**} {
  allow read, create, update, delete: if hasStoreAccess(storeId);
}
```

The function `hasStoreAccess(storeId)` grants access to `admin` users and assigned `manager` users. While this rule *appears* to grant delete permissions to managers, there is a conflicting, more general rule that is likely taking precedence due to how Firestore resolves path specificity:

```rules
// From: firestore.rules

// This is a broader rule matching any document under a store
match /stores/{storeId}/{docPath=**} {
  allow read, create, update: if hasStoreAccess(storeId);
  // CRITICAL: Delete is ONLY allowed for admins here.
  allow delete: if isAdmin();
}
```

**Suspected Failing Operation:**

The `DELETE-STALE-TICKETS` and `DELETE-STALE-SESSIONS` operations are the first destructive actions performed by the tool. When a `manager` (who is not an `admin`) runs the tool, these `delete` operations are denied by the more restrictive second rule, causing the entire transaction to fail with a "Missing or insufficient permissions" error.

| Op ID                      | Action   | Rule Applied (Suspected)                          | Manager Allowed? | Admin Allowed? |
| :------------------------- | :------- | :------------------------------------------------ | :--------------- | :------------- |
| **DELETE-STALE-TICKETS**   | `delete` | `match /stores/{storeId}/{docPath=**}`            | **No**           | Yes            |
| **DELETE-STALE-SESSIONS**  | `delete` | `match /stores/{storeId}/{docPath=**}`            | **No**           | Yes            |
| **WRITE-SESSION-PROJ**     | `write`  | `match /stores/{storeId}/opPages/{docPath=**}`    | Yes              | Yes            |
| **WRITE-TICKET-PROJ**      | `write`  | `match /stores/{storeId}/opPages/{docPath=**}`    | Yes              | Yes            |

## 5. Recommended Fixes

### Option A: Loosen Security Rules (Not Recommended)

Modify `firestore.rules` to allow managers to delete documents within the `opPages` collection. This is generally discouraged as it increases the client-side attack surface.

### Option B: Move to Server-Side Execution (Recommended)

This is the most secure and robust solution.
1.  Create a Next.js API Route (e.g., `/api/admin/rebuild-op-pages`).
2.  Move the entire `rebuildOpPagesForRange` logic into this API route.
3.  Use the **Firebase Admin SDK** within the API route, which bypasses security rules and has full access to the database.
4.  Protect the API route by checking the user's role from their authentication token.
5.  Update the client-side `handleRebuildOps` function to call this new API endpoint instead of executing the logic directly.

### Option C: Hybrid Approach

Keep the read operations on the client but send the list of documents to be deleted and data to be written to a server-side endpoint. This reduces the server's load but adds complexity. Option B is generally preferable.
