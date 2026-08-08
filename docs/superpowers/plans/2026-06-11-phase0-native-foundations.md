# Phase 0 — Native Foundations / De-Risk Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a runnable React Native (Expo) app that proves the four project unknowns before committing to the full rewrite: (1) Expo + EAS builds **iOS from Windows**, (2) `@react-native-firebase` auth works, (3) realtime Firestore listeners work in RN, (4) ESC/POS thermal printing works to a real printer.

**Architecture:** A fresh npm-workspaces monorepo containing `apps/mobile` (Expo, TypeScript, Expo Router, NativeWind) and `packages/printing` (pure-TS ESC/POS formatter). The mobile app talks directly to the existing Firebase project (Auth + Firestore) and prints via a native transport. The existing web app is left untouched in this phase.

**Tech Stack:** Expo (managed + dev-client), TypeScript, Expo Router, NativeWind v4 (Tailwind for RN), `@react-native-firebase/app|auth|firestore`, Jest (`jest-expo` for the app, `ts-jest` for the package), EAS Build, ESC/POS over TCP/LAN (Phase 0 transport).

**Conventions used in this plan**
- Monorepo root: `C:\Users\ianla\webapps\shareat-native` (created in Task 1). All commands run from there unless a `cd` is shown.
- Firebase project = the **same** project the web app uses (read its config from `C:\Users\ianla\webapps\POS\.env.local` and the Firebase console). Use storeId `TEST` for any test reads/writes.
- Each task ends in a commit. Commit messages end with the project's co-author trailer.
- "Native deps" are always installed with `npx expo install <pkg>` (not `npm install`) so versions match the Expo SDK.

**Phase 0 exit criteria (Definition of Done)**
- `npm test` passes across the workspace.
- The app runs on a physical Android device via a dev build and shows: a working Firebase email/password login, a live list from a Firestore `TEST` collection that updates in realtime, and a "Print test receipt" button that prints on a real ESC/POS printer.
- `eas build -p ios` and `eas build -p android` both succeed and produce installable artifacts (proves iOS-from-Windows).

---

## File structure (created by this plan)

```
shareat-native/
  package.json                      # workspace root (npm workspaces)
  tsconfig.base.json                # shared TS config
  .gitignore
  packages/
    printing/
      package.json
      tsconfig.json
      jest.config.js
      src/
        escpos.ts                   # low-level ESC/POS byte helpers
        receiptFormatter.ts         # formatReceipt(receipt) -> Uint8Array
        types.ts                    # Receipt, ReceiptLine types
      src/__tests__/
        escpos.test.ts
        receiptFormatter.test.ts
  apps/
    mobile/
      package.json
      app.json                      # Expo config (plugins, bundle ids)
      babel.config.js
      metro.config.js
      tailwind.config.js
      global.css
      nativewind-env.d.ts
      jest.config.js
      jest-setup.ts
      tsconfig.json
      eas.json                      # EAS Build profiles
      firebase/
        google-services.json        # Android (from Firebase console)
        GoogleService-Info.plist     # iOS (from Firebase console)
      src/
        lib/
          authMapper.ts             # mapFirebaseUser() -> AppUser | null
          listReducer.ts            # applySnapshot() realtime list reducer
          firestoreList.ts          # useFirestoreList() hook
          printTransport.ts         # sendToPrinterTCP() native transport
        __tests__/
          authMapper.test.ts
          listReducer.test.ts
      app/                          # Expo Router screens
        _layout.tsx
        index.tsx                   # auth gate -> login or home
        login.tsx                   # Firebase email/password sign-in
        home.tsx                    # live Firestore list + print button
      components/
        ui/
          Button.tsx                # NativeWind button (reusables-style)
```

---

## Task 1: Initialize the monorepo workspace

**Files:**
- Create: `C:\Users\ianla\webapps\shareat-native\package.json`
- Create: `C:\Users\ianla\webapps\shareat-native\tsconfig.base.json`
- Create: `C:\Users\ianla\webapps\shareat-native\.gitignore`

- [ ] **Step 1: Create the monorepo directory and init git**

Run (PowerShell):
```powershell
New-Item -ItemType Directory -Force C:\Users\ianla\webapps\shareat-native\apps
New-Item -ItemType Directory -Force C:\Users\ianla\webapps\shareat-native\packages
cd C:\Users\ianla\webapps\shareat-native
git init
```
Expected: `Initialized empty Git repository ...`

- [ ] **Step 2: Write the workspace root `package.json`**

`C:\Users\ianla\webapps\shareat-native\package.json`:
```json
{
  "name": "shareat-native",
  "private": true,
  "version": "0.0.0",
  "workspaces": [
    "apps/*",
    "packages/*"
  ],
  "scripts": {
    "test": "npm run test --workspaces --if-present",
    "typecheck": "tsc -b --pretty"
  },
  "engines": {
    "node": ">=20 <21"
  }
}
```

- [ ] **Step 3: Write `tsconfig.base.json`**

`C:\Users\ianla\webapps\shareat-native\tsconfig.base.json`:
```json
{
  "compilerOptions": {
    "target": "ES2021",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2021", "DOM"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "declaration": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

- [ ] **Step 4: Write `.gitignore`**

`C:\Users\ianla\webapps\shareat-native\.gitignore`:
```
node_modules/
dist/
.expo/
ios/
android/
*.log
.DS_Store
# Firebase native config (contains project ids/keys) — keep out of git
apps/mobile/firebase/google-services.json
apps/mobile/firebase/GoogleService-Info.plist
```

- [ ] **Step 5: Install and verify the workspace resolves**

Run:
```powershell
npm install
```
Expected: completes with no error; a root `node_modules/` and `package-lock.json` appear.

- [ ] **Step 6: Commit**

```powershell
git add -A
git commit -m @'
chore: initialize shareat-native monorepo workspace

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 2: Create `packages/printing` with ESC/POS byte helpers (TDD)

**Files:**
- Create: `packages/printing/package.json`
- Create: `packages/printing/tsconfig.json`
- Create: `packages/printing/jest.config.js`
- Create: `packages/printing/src/escpos.ts`
- Test: `packages/printing/src/__tests__/escpos.test.ts`

- [ ] **Step 1: Write the package manifest and configs**

`packages/printing/package.json`:
```json
{
  "name": "@shareat/printing",
  "version": "0.0.0",
  "private": true,
  "main": "src/index.ts",
  "types": "src/index.ts",
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/jest": "^29.5.12",
    "jest": "^29.7.0",
    "ts-jest": "^29.1.2",
    "typescript": "^5"
  }
}
```

`packages/printing/tsconfig.json`:
```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": { "outDir": "dist", "rootDir": "src" },
  "include": ["src"]
}
```

`packages/printing/jest.config.js`:
```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
};
```

Run:
```powershell
npm install
```
Expected: jest/ts-jest installed under the workspace.

- [ ] **Step 2: Write the failing test for ESC/POS helpers**

`packages/printing/src/__tests__/escpos.test.ts`:
```ts
import { ESC, GS, init, text, feed, cut, concat } from '../escpos';

describe('escpos helpers', () => {
  it('init returns ESC @ (1B 40)', () => {
    expect(Array.from(init())).toEqual([ESC, 0x40]);
  });

  it('text encodes ASCII to bytes', () => {
    expect(Array.from(text('Hi'))).toEqual([0x48, 0x69]);
  });

  it('feed(2) returns two line feeds', () => {
    expect(Array.from(feed(2))).toEqual([0x0a, 0x0a]);
  });

  it('cut returns GS V 0 (1D 56 00)', () => {
    expect(Array.from(cut())).toEqual([GS, 0x56, 0x00]);
  });

  it('concat joins byte arrays in order', () => {
    const out = concat(init(), text('A'), feed(1), cut());
    expect(Array.from(out)).toEqual([ESC, 0x40, 0x41, 0x0a, GS, 0x56, 0x00]);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\packages\printing; npm test
```
Expected: FAIL — `Cannot find module '../escpos'`.

- [ ] **Step 4: Implement the ESC/POS helpers**

`packages/printing/src/escpos.ts`:
```ts
export const ESC = 0x1b;
export const GS = 0x1d;

const encoder = new TextEncoder();

export function init(): Uint8Array {
  return new Uint8Array([ESC, 0x40]); // ESC @ — reset
}

export function text(s: string): Uint8Array {
  return encoder.encode(s);
}

export function feed(lines = 1): Uint8Array {
  return new Uint8Array(Array(lines).fill(0x0a));
}

export function cut(): Uint8Array {
  return new Uint8Array([GS, 0x56, 0x00]); // GS V 0 — full cut
}

export function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```powershell
npm test
```
Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(printing): add ESC/POS byte helpers with tests

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 3: Add the receipt formatter to `packages/printing` (TDD)

**Files:**
- Create: `packages/printing/src/types.ts`
- Create: `packages/printing/src/receiptFormatter.ts`
- Create: `packages/printing/src/index.ts`
- Test: `packages/printing/src/__tests__/receiptFormatter.test.ts`

- [ ] **Step 1: Write the receipt types**

`packages/printing/src/types.ts`:
```ts
export interface ReceiptLine {
  name: string;
  qty: number;
  price: number; // line total in centavos (integer)
}

export interface Receipt {
  storeName: string;
  receiptNo: string;
  lines: ReceiptLine[];
  total: number; // centavos (integer)
}
```

- [ ] **Step 2: Write the failing test for `formatReceipt`**

`packages/printing/src/__tests__/receiptFormatter.test.ts`:
```ts
import { formatReceipt } from '../receiptFormatter';
import { ESC, GS } from '../escpos';
import type { Receipt } from '../types';

const sample: Receipt = {
  storeName: 'SharEat TEST',
  receiptNo: 'R-001',
  lines: [
    { name: 'Pork', qty: 2, price: 30000 },
    { name: 'Rice', qty: 1, price: 2500 },
  ],
  total: 32500,
};

describe('formatReceipt', () => {
  it('returns a Uint8Array', () => {
    expect(formatReceipt(sample)).toBeInstanceOf(Uint8Array);
  });

  it('starts with ESC @ (init) and ends with GS V 0 (cut)', () => {
    const bytes = Array.from(formatReceipt(sample));
    expect(bytes.slice(0, 2)).toEqual([ESC, 0x40]);
    expect(bytes.slice(-3)).toEqual([GS, 0x56, 0x00]);
  });

  it('includes the store name, receipt no, item names and peso total as text', () => {
    const str = new TextDecoder().decode(formatReceipt(sample));
    expect(str).toContain('SharEat TEST');
    expect(str).toContain('R-001');
    expect(str).toContain('Pork');
    expect(str).toContain('Rice');
    expect(str).toContain('325.00'); // 32500 centavos formatted as pesos
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\packages\printing; npm test
```
Expected: FAIL — `Cannot find module '../receiptFormatter'`.

- [ ] **Step 4: Implement the formatter and the package entrypoint**

`packages/printing/src/receiptFormatter.ts`:
```ts
import { init, text, feed, cut, concat } from './escpos';
import type { Receipt } from './types';

function peso(centavos: number): string {
  return (centavos / 100).toFixed(2);
}

export function formatReceipt(r: Receipt): Uint8Array {
  const header = `${r.storeName}\nReceipt: ${r.receiptNo}\n--------------------------------\n`;
  const body = r.lines
    .map((l) => `${l.qty}x ${l.name}  ${peso(l.price)}`)
    .join('\n');
  const footer = `\n--------------------------------\nTOTAL  ${peso(r.total)}\n`;

  return concat(
    init(),
    text(header),
    text(body),
    text(footer),
    feed(3),
    cut(),
  );
}
```

`packages/printing/src/index.ts`:
```ts
export * from './escpos';
export * from './types';
export * from './receiptFormatter';
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```powershell
npm test
```
Expected: PASS (all receiptFormatter + escpos tests).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(printing): add receipt formatter producing ESC/POS bytes

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 4: Scaffold the Expo app (`apps/mobile`)

**Files:**
- Create: `apps/mobile/*` (via `create-expo-app`)
- Modify: `apps/mobile/package.json` (name, deps)
- Create: `apps/mobile/tsconfig.json`

- [ ] **Step 1: Scaffold a TypeScript Expo app with Expo Router**

Run from the monorepo root:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps
npx create-expo-app@latest mobile --template
```
When prompted, choose the **"Navigation (TypeScript)"** / Expo Router template. Expected: `apps/mobile` is created with an `app/` directory.

- [ ] **Step 2: Set the package name to fit the workspace**

Edit `apps/mobile/package.json` — set the name and add the workspace package + a test script:
```json
{
  "name": "@shareat/mobile",
  "dependencies": {
    "@shareat/printing": "*"
  },
  "scripts": {
    "test": "jest",
    "typecheck": "tsc --noEmit"
  }
}
```
(Keep all other generated fields/scripts.)

- [ ] **Step 3: Point the app tsconfig at the shared base**

Overwrite `apps/mobile/tsconfig.json`:
```json
{
  "extends": "expo/tsconfig.base",
  "compilerOptions": {
    "strict": true,
    "baseUrl": ".",
    "paths": { "@/*": ["./*"] }
  },
  "include": ["**/*.ts", "**/*.tsx", ".expo/types/**/*.ts", "expo-env.d.ts"]
}
```

- [ ] **Step 4: Install and verify the app boots in a browser (sanity only)**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native
npm install
cd apps\mobile
npx expo start --web
```
Expected: Metro bundles and a default screen renders in the browser. Stop with Ctrl+C. (This is a sanity check; native Firebase/printing require a dev build, added later.)

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(mobile): scaffold Expo app with Expo Router and TypeScript

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 5: Add NativeWind (Tailwind for RN) and a Button component

**Files:**
- Create: `apps/mobile/tailwind.config.js`
- Create: `apps/mobile/global.css`
- Create: `apps/mobile/nativewind-env.d.ts`
- Modify: `apps/mobile/babel.config.js`
- Modify: `apps/mobile/metro.config.js`
- Create: `apps/mobile/components/ui/Button.tsx`

- [ ] **Step 1: Install NativeWind and peers (SDK-aligned)**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps\mobile
npx expo install nativewind tailwindcss react-native-reanimated react-native-safe-area-context
```
Expected: packages install at versions matching the Expo SDK.

- [ ] **Step 2: Configure Tailwind, Babel, Metro, and the global stylesheet**

`apps/mobile/tailwind.config.js` (port the brand deep-red token from the web app):
```js
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: { DEFAULT: '#8B0000', accent: '#FFB300' },
      },
    },
  },
  plugins: [],
};
```

`apps/mobile/global.css`:
```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

`apps/mobile/babel.config.js`:
```js
module.exports = function (api) {
  api.cache(true);
  return {
    presets: [
      ['babel-preset-expo', { jsxImportSource: 'nativewind' }],
      'nativewind/babel',
    ],
  };
};
```

`apps/mobile/metro.config.js`:
```js
const { getDefaultConfig } = require('expo/metro-config');
const { withNativeWind } = require('nativewind/metro');

const config = getDefaultConfig(__dirname);
module.exports = withNativeWind(config, { input: './global.css' });
```

`apps/mobile/nativewind-env.d.ts`:
```ts
/// <reference types="nativewind/types" />
```

- [ ] **Step 3: Import the stylesheet in the root layout**

Add this import as the **first line** of `apps/mobile/app/_layout.tsx`:
```tsx
import '../global.css';
```

- [ ] **Step 4: Create the Button component**

`apps/mobile/components/ui/Button.tsx`:
```tsx
import { Pressable, Text } from 'react-native';

export function Button({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      className={`rounded-xl px-5 py-3 ${disabled ? 'bg-gray-400' : 'bg-brand'}`}
    >
      <Text className="text-center text-base font-semibold text-white">{label}</Text>
    </Pressable>
  );
}
```

- [ ] **Step 5: Verify it bundles**

Run:
```powershell
npx expo start --web
```
Expected: bundles with no NativeWind/Babel errors. Stop with Ctrl+C.

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(mobile): add NativeWind styling and brand Button component

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 6: Add Jest (`jest-expo`) and the auth mapper (TDD)

**Files:**
- Create: `apps/mobile/jest.config.js`
- Create: `apps/mobile/jest-setup.ts`
- Modify: `apps/mobile/package.json` (jest devDeps)
- Create: `apps/mobile/src/lib/authMapper.ts`
- Test: `apps/mobile/src/__tests__/authMapper.test.ts`

- [ ] **Step 1: Install jest-expo and configure Jest**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps\mobile
npx expo install jest-expo jest
npx expo install --dev @types/jest
```

`apps/mobile/jest.config.js`:
```js
/** @type {import('jest').Config} */
module.exports = {
  preset: 'jest-expo',
  setupFilesAfterEnv: ['<rootDir>/jest-setup.ts'],
  testMatch: ['**/__tests__/**/*.test.ts', '**/__tests__/**/*.test.tsx'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo(nent)?|@expo(nent)?/.*|@react-navigation/.*|nativewind|react-native-css-interop)/)',
  ],
};
```

`apps/mobile/jest-setup.ts`:
```ts
// Reserved for global test setup (mocks added in later tasks).
export {};
```

- [ ] **Step 2: Write the failing test for the auth mapper**

`apps/mobile/src/__tests__/authMapper.test.ts`:
```ts
import { mapFirebaseUser, type AppUser } from '../lib/authMapper';

describe('mapFirebaseUser', () => {
  it('returns null when there is no firebase user', () => {
    expect(mapFirebaseUser(null, null)).toBeNull();
  });

  it('maps uid/email and reads role + storeIds from the profile doc', () => {
    const fbUser = { uid: 'u1', email: 'a@b.com' };
    const profile = { role: 'cashier', storeIds: ['TEST'], status: 'active' };
    const result = mapFirebaseUser(fbUser, profile);
    expect(result).toEqual<AppUser>({
      uid: 'u1',
      email: 'a@b.com',
      role: 'cashier',
      storeIds: ['TEST'],
      status: 'active',
    });
  });

  it('defaults role to "pending" and status to "pending" when profile is missing', () => {
    const result = mapFirebaseUser({ uid: 'u2', email: null }, null);
    expect(result).toEqual<AppUser>({
      uid: 'u2',
      email: null,
      role: 'pending',
      storeIds: [],
      status: 'pending',
    });
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run:
```powershell
npm test
```
Expected: FAIL — `Cannot find module '../lib/authMapper'`.

- [ ] **Step 4: Implement the auth mapper**

`apps/mobile/src/lib/authMapper.ts`:
```ts
export type Role = 'admin' | 'manager' | 'cashier' | 'server' | 'kitchen' | 'account' | 'pending';

export interface AppUser {
  uid: string;
  email: string | null;
  role: Role;
  storeIds: string[];
  status: 'active' | 'pending' | 'disabled';
}

interface FirebaseUserLike {
  uid: string;
  email: string | null;
}

interface ProfileDocLike {
  role?: Role;
  storeIds?: string[];
  status?: AppUser['status'];
}

export function mapFirebaseUser(
  fbUser: FirebaseUserLike | null,
  profile: ProfileDocLike | null,
): AppUser | null {
  if (!fbUser) return null;
  return {
    uid: fbUser.uid,
    email: fbUser.email,
    role: profile?.role ?? 'pending',
    storeIds: profile?.storeIds ?? [],
    status: profile?.status ?? 'pending',
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run:
```powershell
npm test
```
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(mobile): add Jest (jest-expo) and tested auth mapper

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 7: Add the realtime list reducer (TDD)

**Files:**
- Create: `apps/mobile/src/lib/listReducer.ts`
- Test: `apps/mobile/src/__tests__/listReducer.test.ts`

This is the pure, testable core of the realtime listener: given the previous list and a set of
Firestore doc changes, produce the next list. The `onSnapshot` hook (Task 9) feeds it real data.

- [ ] **Step 1: Write the failing test**

`apps/mobile/src/__tests__/listReducer.test.ts`:
```ts
import { applySnapshot, type DocChange, type Doc } from '../lib/listReducer';

const make = (id: string, n: number): DocChange => ({
  type: 'added',
  doc: { id, data: { n } },
});

describe('applySnapshot', () => {
  it('adds new docs', () => {
    const next = applySnapshot([], [make('a', 1), make('b', 2)]);
    expect(next.map((d) => d.id)).toEqual(['a', 'b']);
  });

  it('modifies an existing doc in place', () => {
    const start: Doc[] = [{ id: 'a', data: { n: 1 } }];
    const next = applySnapshot(start, [{ type: 'modified', doc: { id: 'a', data: { n: 9 } } }]);
    expect(next).toEqual([{ id: 'a', data: { n: 9 } }]);
  });

  it('removes a doc', () => {
    const start: Doc[] = [{ id: 'a', data: { n: 1 } }, { id: 'b', data: { n: 2 } }];
    const next = applySnapshot(start, [{ type: 'removed', doc: { id: 'a', data: {} } }]);
    expect(next.map((d) => d.id)).toEqual(['b']);
  });

  it('does not mutate the input array', () => {
    const start: Doc[] = [{ id: 'a', data: { n: 1 } }];
    applySnapshot(start, [make('b', 2)]);
    expect(start.map((d) => d.id)).toEqual(['a']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps\mobile; npm test
```
Expected: FAIL — `Cannot find module '../lib/listReducer'`.

- [ ] **Step 3: Implement the reducer**

`apps/mobile/src/lib/listReducer.ts`:
```ts
export interface Doc {
  id: string;
  data: Record<string, unknown>;
}

export interface DocChange {
  type: 'added' | 'modified' | 'removed';
  doc: Doc;
}

export function applySnapshot(prev: Doc[], changes: DocChange[]): Doc[] {
  const map = new Map(prev.map((d) => [d.id, d]));
  for (const change of changes) {
    if (change.type === 'removed') {
      map.delete(change.doc.id);
    } else {
      map.set(change.doc.id, change.doc); // added or modified
    }
  }
  return Array.from(map.values());
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```powershell
npm test
```
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(mobile): add tested realtime list reducer

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 8: Wire `@react-native-firebase` and the native config

**Files:**
- Modify: `apps/mobile/app.json` (plugins, bundle ids)
- Create: `apps/mobile/firebase/google-services.json` (from Firebase console)
- Create: `apps/mobile/firebase/GoogleService-Info.plist` (from Firebase console)

> **Note:** `@react-native-firebase` is a native module — it does **not** run in Expo Go. It requires a **dev build** (Task 10). This task installs and configures it; the first real run happens after the dev build.

- [ ] **Step 1: Install the Firebase native packages**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps\mobile
npx expo install @react-native-firebase/app @react-native-firebase/auth @react-native-firebase/firestore expo-build-properties
```

- [ ] **Step 2: Download the native Firebase config files**

From the Firebase console for the **same project the web app uses** (cross-check the project id against `C:\Users\ianla\webapps\POS\.env.local`):
- Add an **Android app** with package `net.shareat.pos` → download `google-services.json` → save to `apps/mobile/firebase/google-services.json`.
- Add an **iOS app** with bundle id `net.shareat.pos` → download `GoogleService-Info.plist` → save to `apps/mobile/firebase/GoogleService-Info.plist`.

Expected: both files exist at the paths above. (They are git-ignored per Task 1.)

- [ ] **Step 3: Configure the Expo plugins and bundle ids**

Edit `apps/mobile/app.json` — inside the `"expo"` object, set/add:
```json
{
  "expo": {
    "ios": {
      "bundleIdentifier": "net.shareat.pos",
      "googleServicesFile": "./firebase/GoogleService-Info.plist"
    },
    "android": {
      "package": "net.shareat.pos",
      "googleServicesFile": "./firebase/google-services.json"
    },
    "plugins": [
      "expo-router",
      "@react-native-firebase/app",
      "@react-native-firebase/auth",
      [
        "expo-build-properties",
        { "ios": { "useFrameworks": "static" } }
      ]
    ]
  }
}
```
(Keep existing fields such as `name`, `slug`, `scheme`. If `plugins` already lists `expo-router`, merge rather than duplicate.)

- [ ] **Step 4: Verify the config is valid**

Run:
```powershell
npx expo config --type public
```
Expected: prints the resolved config JSON with no plugin errors, showing the firebase plugins and bundle ids.

- [ ] **Step 5: Commit (config only — the two firebase files are git-ignored)**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
chore(mobile): configure @react-native-firebase plugins and bundle ids

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 9: Build the login + live Firestore screens

**Files:**
- Create: `apps/mobile/src/lib/firestoreList.ts` (the `useFirestoreList` hook)
- Modify: `apps/mobile/app/_layout.tsx`
- Create: `apps/mobile/app/index.tsx`
- Create: `apps/mobile/app/login.tsx`
- Create: `apps/mobile/app/home.tsx`

> These screens use the native Firebase SDK, so they only run correctly inside the dev build
> (Task 10). Verification happens there; here we write the code and confirm it typechecks/bundles.

- [ ] **Step 1: Write the `useFirestoreList` hook (uses Task 7's reducer)**

`apps/mobile/src/lib/firestoreList.ts`:
```ts
import { useEffect, useState } from 'react';
import firestore from '@react-native-firebase/firestore';
import { applySnapshot, type Doc } from './listReducer';

export function useFirestoreList(collectionPath: string): { docs: Doc[]; loading: boolean } {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsub = firestore()
      .collection(collectionPath)
      .onSnapshot((snap) => {
        const changes = snap.docChanges().map((c) => ({
          type: c.type as 'added' | 'modified' | 'removed',
          doc: { id: c.doc.id, data: c.doc.data() as Record<string, unknown> },
        }));
        setDocs((prev) => applySnapshot(prev, changes));
        setLoading(false);
      });
    return () => unsub();
  }, [collectionPath]);

  return { docs, loading };
}
```

- [ ] **Step 2: Write the auth-gate root index**

`apps/mobile/app/index.tsx`:
```tsx
import { useEffect, useState } from 'react';
import { Redirect } from 'expo-router';
import { View, ActivityIndicator } from 'react-native';
import auth, { type FirebaseAuthTypes } from '@react-native-firebase/auth';

export default function Index() {
  const [user, setUser] = useState<FirebaseAuthTypes.User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => auth().onAuthStateChanged((u) => { setUser(u); setReady(true); }), []);

  if (!ready) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }
  return <Redirect href={user ? '/home' : '/login'} />;
}
```

- [ ] **Step 3: Write the login screen**

`apps/mobile/app/login.tsx`:
```tsx
import { useState } from 'react';
import { View, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import auth from '@react-native-firebase/auth';
import { Button } from '../components/ui/Button';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signIn() {
    setBusy(true);
    setError(null);
    try {
      await auth().signInWithEmailAndPassword(email.trim(), password);
      router.replace('/home');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View className="flex-1 justify-center gap-3 bg-white px-6">
      <Text className="mb-2 text-2xl font-bold text-brand">SharEat POS</Text>
      <TextInput
        className="rounded-lg border border-gray-300 px-4 py-3"
        placeholder="Email"
        autoCapitalize="none"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
      />
      <TextInput
        className="rounded-lg border border-gray-300 px-4 py-3"
        placeholder="Password"
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />
      {error && <Text className="text-red-600">{error}</Text>}
      <Button label={busy ? 'Signing in…' : 'Sign in'} onPress={signIn} disabled={busy} />
    </View>
  );
}
```

- [ ] **Step 4: Write the home screen (live list + sign out)**

`apps/mobile/app/home.tsx`:
```tsx
import { View, Text, FlatList } from 'react-native';
import auth from '@react-native-firebase/auth';
import { useFirestoreList } from '../src/lib/firestoreList';
import { Button } from '../components/ui/Button';

export default function Home() {
  // storeId TEST is the sanctioned dev test space.
  const { docs, loading } = useFirestoreList('stores/TEST/smoketest');

  return (
    <View className="flex-1 bg-white px-6 pt-16">
      <Text className="mb-4 text-xl font-bold text-brand">Live Firestore (TEST)</Text>
      {loading ? (
        <Text>Loading…</Text>
      ) : (
        <FlatList
          data={docs}
          keyExtractor={(d) => d.id}
          renderItem={({ item }) => (
            <Text className="border-b border-gray-200 py-2">
              {item.id}: {JSON.stringify(item.data)}
            </Text>
          )}
          ListEmptyComponent={<Text className="text-gray-500">No docs yet — add one in the console.</Text>}
        />
      )}
      <View className="py-6">
        <Button label="Sign out" onPress={() => auth().signOut()} />
      </View>
    </View>
  );
}
```

- [ ] **Step 5: Confirm Stack routing exists in the layout**

Ensure `apps/mobile/app/_layout.tsx` keeps its `import '../global.css';` first line and renders a `Stack` (the Expo Router template provides this). If it uses a different navigator, leave it; Expo Router will resolve `index`, `login`, and `home` routes from the files.

- [ ] **Step 6: Typecheck and bundle**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps\mobile
npx tsc --noEmit
```
Expected: no type errors. (A web bundle will fail at runtime on native Firebase calls — that's expected; the dev build in Task 10 is where it runs.)

- [ ] **Step 7: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(mobile): add login + live Firestore home screens

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 10: Configure EAS and build a dev client; run on a device

**Files:**
- Create: `apps/mobile/eas.json`

This task proves unknown #1 (**iOS build from Windows**) and gives a dev build that can run the
native Firebase screens.

- [ ] **Step 1: Install EAS CLI and log in**

Run:
```powershell
npm install -g eas-cli
eas login
```
Expected: logged in to your Expo account. (If you don't have one, create it at expo.dev first.)

- [ ] **Step 2: Configure the project for EAS**

Run from `apps/mobile`:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps\mobile
eas build:configure
```
Then overwrite `apps/mobile/eas.json`:
```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {}
  }
}
```

- [ ] **Step 3: Build an Android dev client and install it on a device**

Run:
```powershell
eas build --profile development --platform android
```
Expected: cloud build succeeds and produces an installable `.apk`/dev-client. Install it on a physical Android device (download the link EAS prints).

- [ ] **Step 4: Build an iOS dev client (proves iOS-from-Windows)**

Run:
```powershell
eas build --profile development --platform ios
```
Expected: EAS prompts for Apple credentials / provisioning (handled in the cloud), then succeeds and produces an iOS build. **Success here is the key Phase-0 milestone: iOS built without a Mac.** (Installing on a physical iPhone/iPad requires the device UDID registered with EAS, or use a TestFlight build via the `preview`/`production` profile later.)

- [ ] **Step 5: Run the dev server against the installed dev client**

Run:
```powershell
npx expo start --dev-client
```
On the Android device, open the installed dev build and connect. Verify:
- Login screen appears; sign in with a known Firebase user → lands on Home.
- Add a doc under `stores/TEST/smoketest` in the Firebase console → it appears on Home **in realtime** without reload.
- Sign out returns to login.

Expected: all three behaviors work. This proves unknowns #2 (auth) and #3 (realtime Firestore).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
chore(mobile): add EAS build config (dev client, iOS+Android)

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 11: Prove thermal printing to a real printer

**Files:**
- Create: `apps/mobile/src/lib/printTransport.ts` (TCP/LAN ESC/POS transport)
- Modify: `apps/mobile/app/home.tsx` (add a "Print test receipt" button)

> **Why TCP/LAN first:** a network ESC/POS printer is the simplest transport to prove the
> end-to-end path (formatter → bytes → printer) without BLE pairing complexity. Once proven,
> Phase 2 adds BLE/USB transports behind the same `sendToPrinter` interface. If your only printer
> is Bluetooth, substitute `react-native-ble-plx` here using the same `Uint8Array` payload.

- [ ] **Step 1: Install a TCP socket library**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native\apps\mobile
npx expo install react-native-tcp-socket
npm install buffer
```
(`buffer` gives a reliable `Buffer` in RN rather than relying on a global polyfill.)

- [ ] **Step 2: Implement the transport (consumes the shared formatter bytes)**

`apps/mobile/src/lib/printTransport.ts`:
```ts
import TcpSocket from 'react-native-tcp-socket';
import { Buffer } from 'buffer';

/** Send raw ESC/POS bytes to a network printer (port 9100 is the ESC/POS standard). */
export function sendToPrinterTCP(host: string, bytes: Uint8Array, port = 9100): Promise<void> {
  return new Promise((resolve, reject) => {
    const client = TcpSocket.createConnection({ host, port }, () => {
      client.write(Buffer.from(bytes));
      client.end();
    });
    client.on('error', (err) => reject(err));
    client.on('close', () => resolve());
  });
}
```

- [ ] **Step 3: Add a print button to Home using the shared formatter**

In `apps/mobile/app/home.tsx`, add these imports at the top:
```tsx
import { formatReceipt } from '@shareat/printing';
import { sendToPrinterTCP } from '../src/lib/printTransport';
```
Add this button inside the bottom `View` (above or below "Sign out"). **Replace `192.168.1.50` with your printer's IP.**
```tsx
<View className="pb-3">
  <Button
    label="Print test receipt"
    onPress={() =>
      sendToPrinterTCP(
        '192.168.1.50',
        formatReceipt({
          storeName: 'SharEat TEST',
          receiptNo: 'R-0001',
          lines: [
            { name: 'Pork', qty: 2, price: 30000 },
            { name: 'Rice', qty: 1, price: 2500 },
          ],
          total: 32500,
        }),
      ).catch((e) => console.warn('print failed', e))
    }
  />
</View>
```

- [ ] **Step 4: Rebuild the dev client (new native module added)**

Adding `react-native-tcp-socket` changes native code, so rebuild:
```powershell
eas build --profile development --platform android
```
Install the new build on the device.

- [ ] **Step 5: Verify a physical print**

Connect the device and printer to the **same network**, run `npx expo start --dev-client`, open Home, tap **Print test receipt**.
Expected: the printer prints a receipt showing "SharEat TEST", "R-0001", the two items, and "TOTAL 325.00", then cuts. This proves unknown #4 (printing).

- [ ] **Step 6: Commit**

```powershell
cd C:\Users\ianla\webapps\shareat-native
git add -A
git commit -m @'
feat(mobile): prove ESC/POS thermal printing via TCP transport

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
```

---

## Task 12: Phase 0 wrap-up — run the full suite and tag

**Files:**
- Create: `C:\Users\ianla\webapps\shareat-native\README.md`

- [ ] **Step 1: Run the entire test suite from the root**

Run:
```powershell
cd C:\Users\ianla\webapps\shareat-native
npm test
```
Expected: PASS in both `@shareat/printing` and `@shareat/mobile`.

- [ ] **Step 2: Write the README capturing the proven setup**

`C:\Users\ianla\webapps\shareat-native\README.md`:
```markdown
# shareat-native

Native (React Native / Expo) rewrite of SharEat POS/ERP. See the design + plan docs in the
`POS` repo under `docs/superpowers/`.

## Phase 0 status: foundations proven
- Expo + EAS Build: iOS and Android builds succeed from Windows (no Mac).
- @react-native-firebase auth + realtime Firestore working on a physical device.
- ESC/POS thermal printing working via TCP transport, using the shared `@shareat/printing` formatter.

## Dev workflow
- `npm install` at the root (npm workspaces).
- `npm test` runs all package + app tests.
- `cd apps/mobile && npx expo start --dev-client` to run against an installed dev build.
- `eas build --profile development --platform android|ios` to produce dev clients.

## Firebase native config (not in git)
Place `google-services.json` and `GoogleService-Info.plist` in `apps/mobile/firebase/`
(download from the Firebase console for the project used by the web app).
```

- [ ] **Step 3: Commit and tag the milestone**

```powershell
git add -A
git commit -m @'
docs: add README; Phase 0 foundations complete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>
'@
git tag phase-0-complete
```

- [ ] **Step 4: Confirm exit criteria**

Verify all are true (manual checklist):
- [ ] `npm test` passes at the root.
- [ ] Android dev build runs on a physical device: login works, Firestore list updates in realtime, sign-out works.
- [ ] `eas build -p ios` succeeded (artifact produced) — iOS-from-Windows proven.
- [ ] A real ESC/POS printer printed the test receipt.

---

## Next phases (separate plans, written after Phase 0 validates the approach)

- **Phase 1 — Shared core:** pull the existing web app into `apps/web`; extract portable `src/lib`
  into `packages/core`; migrate the full receipt/sales formatters into `packages/printing`; point
  the web app at the shared packages.
- **Phase 2 — Cashier/POS:** sessions, bills, discounts, payments, offline queue, receipt printing.
- **Phase 3 — Kitchen (KDS) + Server + Refill.**
- **Phase 4 — Manager + reports.**
- **Phase 5 — Admin/ERP.**
- **Phase 6 — Hardening & store launch.**

Each gets its own `docs/superpowers/plans/*.md` with the same bite-sized TDD structure.
