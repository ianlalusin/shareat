# Changelog - Auth/RBAC Cleanup

This log tracks the changes made during the `fix/auth-rbac-cleanup-01` task.

## Step 1: Stop Link/Onboard Loop

- **`src/context/auth-context.tsx`**
  - Added `isStaffActive` helper function to check for `employmentStatus === 'active'` (case-insensitive) or `is_active === true`.
  - Replaced the strict `employmentStatus` check with the new `isStaffActive` helper.
  - Wrapped the `lastLoginAt` update in a `try/catch` block to prevent auth failures on write errors.
  - Implemented "auto-heal" logic: on login, it now queries `staff` by `authUid` first. If an active staff member is found, it ensures the corresponding `users/{uid}` document is correctly created or patched with the `staffId`, `role`, and other details. This makes `authUid` the canonical link. `isOnboarded` is only set to `true` if this link to an active staff member is confirmed.

- **`src/components/auth/first-login-guard.tsx`**
  - In `OnboardingFlowManager`, added a preliminary check to query `staff` by `authUid`. If an active staff member is found, it ensures the `users` doc is linked and redirects to the main app, bypassing the email lookup.
  - Modified the fallback "staff by email" query to remove the `where("employmentStatus", "==","Active")` clause.
  - The results of the email query are now filtered in the code using the `isStaffActive` helper from the auth context, making the check more robust.
  - If a single active staff member is found by email and already has the correct `authUid`, the user is treated as linked, fixing a potential redirect loop.
- Ensured all necessary Firestore functions (`collection`, `query`, `where`, `getDocs`, `setDoc`, etc.) are correctly imported where used.