export type UserRole = 'admin' | 'manager' | 'cashier' | 'server' | 'kitchen' | string;

export function canDelete(role: UserRole): boolean {
  return role?.toLowerCase() === 'admin';
}

export function canEdit(role: UserRole): boolean {
  const r = role?.toLowerCase();
  return r === 'admin' || r === 'manager';
}

export function canCreate(role: UserRole): boolean {
  const r = role?.toLowerCase();
  return r === 'admin' || r === 'manager';
}

export function requiresApprovalForProfileUpdate(role?: UserRole | null): boolean {
    if (!role) return true; // Default to requiring approval if role is unknown
    const r = role.toLowerCase();
    return r !== 'admin';
}
