
'use client';

import { query, where, type QueryConstraint } from 'firebase/firestore';

export type Scope = {
  role?: string | null;
  activeStoreId?: string | null;
  storeName?: string | null;
  isActiveStaff?: boolean;
};

/**
 * Checks if the user has an admin role.
 * @param scope The user's scope object from auth context.
 * @returns True if the user is an admin.
 */
export function isAdmin(scope: Scope): boolean {
  return (scope.role ?? '').toLowerCase() === 'admin';
}

/**
 * Asserts whether the current user has permission to load store-specific data.
 * @param scope The user's scope object.
 * @returns An object with `ok: true` or `ok: false` and a reason.
 */
export function assertCanLoad(scope: Scope): { ok: true } | { ok: false; reason: 'inactive' | 'no_store' } {
  if (!scope.isActiveStaff) return { ok: false, reason: 'inactive' };
  if (!isAdmin(scope) && !scope.activeStoreId) return { ok: false, reason: 'no_store' };
  return { ok: true };
}

/**
 * Adds a `where('storeId', '==', activeStoreId)` constraint to a Firestore query if the user is not an admin.
 * @param originalConstraints The existing query constraints.
 * @param scope The user's scope object.
 * @returns An array of query constraints including the store filter if applicable.
 */
export function applyStoreFilter(originalConstraints: QueryConstraint[], scope: Scope): QueryConstraint[] {
  if (isAdmin(scope) || !scope.activeStoreId) {
    return originalConstraints;
  }
  return [...originalConstraints, where('storeId', '==', scope.activeStoreId)];
}

/**
 * Adds a `where('assignedStore', '==', storeName)` constraint to a Firestore query if the user is not an admin.
 * @param originalConstraints The existing query constraints.
 * @param scope The user's scope object.
 * @returns An array of query constraints including the store name filter if applicable.
 */
export function applyStoreNameFilter(originalConstraints: QueryConstraint[], scope: Scope): QueryConstraint[] {
    if (isAdmin(scope) || !scope.storeName) {
        return originalConstraints;
    }
    return [...originalConstraints, where('assignedStore', '==', scope.storeName)];
}


/**
 * Injects the `activeStoreId` into a data object before writing to Firestore, if the user is not an admin.
 * @param data The data object to be written.
 * @param scope The user's scope object.
 * @returns The data object, potentially with `storeId` added.
 */
export function stampStoreId<T extends Record<string, any>>(data: T, scope: Scope): T {
  if (isAdmin(scope) || !scope.activeStoreId) {
    return data;
  }
  return { ...data, storeId: scope.activeStoreId };
}
