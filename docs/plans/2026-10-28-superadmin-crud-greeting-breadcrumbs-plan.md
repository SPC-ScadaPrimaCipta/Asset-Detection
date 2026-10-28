# Superadmin User CRUD, Dynamic User Greeting, and Global Breadcrumbs Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Implement dynamic username greeting in the top header, introduce a dedicated `SUPERADMIN` role with central User Management (CRUD) while locking public self-registration, and establish a global auto-mapped Breadcrumbs navigation across all pages.

**Architecture:** A lightweight React `UserContext` caches user session data from `/api/auth/me` to supply user information to both `<Header>` and `<SidebarNav>` without duplicate network requests. PostgreSQL database constraints are updated to allow `'SUPERADMIN'`, and a new dedicated superadmin account is seeded. An administrative REST API (`/api/admin/users`) and dedicated UI (`/users`) allow only Superadmins to manage users, while public self-registration routes (`/register`) are disabled. A dynamic `<Breadcrumbs>` component integrated in `AppShell` automatically maps Next.js route segments to human-readable breadcrumb trails starting at "Dashboard".

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, PostgreSQL (via `pg`), Tailwind CSS, Lucide Icons, Node.js native `crypto.scrypt`.

---

### Task 1: Database Migration & Superadmin Seeding

**Files:**
- Create: `sql/migrate-superadmin.sql`
- Create: `scripts/migrate-superadmin.ts`
- Test: `scripts/test-superadmin-db.ts`

**Step 1: Write the migration SQL file**
Alter table `users` check constraint to include `'SUPERADMIN'` and create index on `role`.

```sql
-- sql/migrate-superadmin.sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('SUPERADMIN', 'ADMIN', 'USER'));

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
```

**Step 2: Write the TypeScript migration runner and seeder**
Create script to run the migration and insert a new superadmin account (`superadmin@assetdetection.local` / `superadmin123`) if it does not already exist.

```typescript
// scripts/migrate-superadmin.ts
import { pool } from '../lib/db';
import { hashPassword } from '../lib/auth';

export async function runSuperAdminMigration() {
  await pool.query(`
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
    ALTER TABLE users ADD CONSTRAINT users_role_check 
      CHECK (role IN ('SUPERADMIN', 'ADMIN', 'USER'));
    CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
  `);

  const existing = await pool.query(
    `SELECT id FROM users WHERE email = 'superadmin@assetdetection.local'`
  );

  if (existing.rows.length === 0) {
    const passwordHash = await hashPassword('superadmin123');
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, $3, 'SUPERADMIN')`,
      ['Super Admin', 'superadmin@assetdetection.local', passwordHash]
    );
    console.log('[migration] Created initial Superadmin account: superadmin@assetdetection.local');
  } else {
    console.log('[migration] Superadmin account already exists.');
  }
}

if (require.main === module) {
  runSuperAdminMigration()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
```

**Step 3: Run the migration script**
Run: `npx tsx -r dotenv/config scripts/migrate-superadmin.ts dotenv_config_path=.env.local`
Expected: Successfully applied constraint and seeded `superadmin@assetdetection.local`.

**Step 4: Verify in database**
Run: `npx tsx -r dotenv/config -e "import { pool } from './lib/db'; pool.query(\"SELECT email, role FROM users WHERE role = 'SUPERADMIN'\").then(r => console.log(r.rows)).then(() => process.exit(0))" dotenv_config_path=.env.local`
Expected: Output showing `superadmin@assetdetection.local` with role `'SUPERADMIN'`.

**Step 5: Commit**
```bash
git add sql/migrate-superadmin.sql scripts/migrate-superadmin.ts
git commit -m "feat(auth): add superadmin role migration and seed initial superadmin"
```

---

### Task 2: Core Auth Helpers & Public Registration Lockdown

**Files:**
- Modify: `lib/auth.ts`
- Modify: `middleware.ts`
- Modify: `app/login/page.tsx`
- Modify: `app/api/auth/register/route.ts`

**Step 1: Update Auth types and add role helpers in `lib/auth.ts`**
Add `UserRole = 'SUPERADMIN' | 'ADMIN' | 'USER'`, and helper functions `isSuperAdmin(user)` and `isPrivileged(user)`.

```typescript
export type UserRole = 'SUPERADMIN' | 'ADMIN' | 'USER';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: UserRole;
}

export function isSuperAdmin(user?: AuthUser | null): boolean {
  return user?.role === 'SUPERADMIN';
}

export function isPrivileged(user?: AuthUser | null): boolean {
  return user?.role === 'ADMIN' || user?.role === 'SUPERADMIN';
}
```

**Step 2: Lock public self-registration in `middleware.ts`**
Redirect requests targeting `/register` to `/login?notice=contact_admin`.

```typescript
// in middleware.ts
if (pathname === '/register') {
  return NextResponse.redirect(new URL('/login?notice=contact_admin', request.url));
}
```

**Step 3: Update `app/login/page.tsx`**
- Remove the link *"Belum punya akun? Daftar Sekarang"*.
- If query parameter `notice=contact_admin` is present, display a friendly notice: *"Pendaftaran akun baru dikelola oleh Super Administrator. Silakan hubungi admin untuk mendapatkan akses."*

**Step 4: Lock `app/api/auth/register/route.ts`**
Only allow user creation if the requester has an active session with `role === 'SUPERADMIN'`, or reject with `403 Forbidden`.

**Step 5: Test and commit**
Run: `npm run build` or `npx tsc --noEmit`
Verify: Accessing `/register` in middleware or calling `POST /api/auth/register` without superadmin returns rejection.
```bash
git add lib/auth.ts middleware.ts app/login/page.tsx app/api/auth/register/route.ts
git commit -m "feat(auth): lock public registration and add superadmin helpers"
```

---

### Task 3: User Context & Dynamic User Greeting ("Welcome Back, [Username]")

**Files:**
- Create: `components/UserContext.tsx`
- Modify: `app/layout.tsx`
- Modify: `components/AppShell.tsx`
- Modify: `components/Header.tsx`
- Modify: `app/sidebar-nav.tsx`

**Step 1: Create `components/UserContext.tsx`**
Provides `user`, `loading`, and `refreshUser()` to all client components.

```typescript
'use client';

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { AuthUser } from '@/lib/auth';

interface UserContextValue {
  user: AuthUser | null;
  loading: boolean;
  refreshUser: () => Promise<void>;
}

const UserContext = createContext<UserContextValue>({
  user: null,
  loading: true,
  refreshUser: async () => {},
});

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchUser = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        setUser(data.user);
      } else {
        setUser(null);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchUser();
  }, [fetchUser]);

  return (
    <UserContext.Provider value={{ user, loading, refreshUser: fetchUser }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser() {
  return useContext(UserContext);
}
```

**Step 2: Wrap RootLayout with `UserProvider`**
In `app/layout.tsx`, wrap `{children}` inside `<UserProvider>` (inside `<ThemeProvider>`).

**Step 3: Update `components/AppShell.tsx` and `components/Header.tsx`**
In `AppShell.tsx`:
```tsx
const { user } = useUser();
...
<Header operatorName={user?.name || 'Operator'} />
```
In `Header.tsx`, verify it displays:
- Greeting: `Welcome Back,`
- Username: `{operatorName}`

**Step 4: Update `app/sidebar-nav.tsx`**
Use `useUser()` from `UserContext` instead of duplicate local `fetch('/api/auth/me')`. Update role display badge:
- `SUPERADMIN` $\rightarrow$ `Super Admin`
- `ADMIN` $\rightarrow$ `Administrator`
- `USER` $\rightarrow$ `User`

**Step 5: Verify greeting and commit**
Run: `npx tsc --noEmit`
Commit:
```bash
git add components/UserContext.tsx app/layout.tsx components/AppShell.tsx components/Header.tsx app/sidebar-nav.tsx
git commit -m "feat(ui): add UserContext and dynamic username greeting in Header"
```

---

### Task 4: Global Breadcrumbs System & Sidebar Navigation Update

**Files:**
- Create: `components/Breadcrumbs.tsx`
- Modify: `components/AppShell.tsx`
- Modify: `app/sidebar-nav.tsx`

**Step 1: Update Sidebar menu item label**
In `app/sidebar-nav.tsx`, change:
```typescript
{ href: '/', label: 'Overview', icon: LayoutDashboard }
```
to:
```typescript
{ href: '/', label: 'Dashboard', icon: LayoutDashboard }
```

**Step 2: Create `components/Breadcrumbs.tsx`**
Parse `pathname` using Next.js `usePathname()`.
Map path segments:
- Root is always `Dashboard` (`/`)
- `/projects` $\rightarrow$ `Dashboard` > `Projects`
- `/detection` $\rightarrow$ `Dashboard` > `Detection Workspace`
- `/mdo` $\rightarrow$ `Dashboard` > `MDO Flow`
- `/documents` $\rightarrow$ `Dashboard` > `Documents`
- `/legends` $\rightarrow$ `Dashboard` > `Legends`
- `/legends/new` $\rightarrow$ `Dashboard` > `Legends` > `New Legend`
- `/legends/[id]` $\rightarrow$ `Dashboard` > `Legends` > `Detail`
- `/legends/[id]/review` $\rightarrow$ `Dashboard` > `Legends` > `Detail` > `Review`
- `/settings` $\rightarrow$ `Dashboard` > `Settings`
- `/users` $\rightarrow$ `Dashboard` > `User Management`

Style with:
- Root home icon (`Home` from Lucide, 14px)
- Subtle separator (`ChevronRight` 13px with `var(--border)` or muted color)
- Active page in `var(--text-primary)` (font-weight 600)
- Inactive links in `var(--text-secondary)` with hover effect.

**Step 3: Mount `<Breadcrumbs />` in `AppShell.tsx`**
Render `<Breadcrumbs />` right under `<Header />` and above `{children}`.

**Step 4: Test and commit**
Run: `npx tsc --noEmit`
Commit:
```bash
git add components/Breadcrumbs.tsx components/AppShell.tsx app/sidebar-nav.tsx
git commit -m "feat(ui): implement global auto-mapped Breadcrumbs and rename Overview to Dashboard"
```

---

### Task 5: Superadmin User Management Backend API (`/api/admin/users`)

**Files:**
- Create: `app/api/admin/users/route.ts`
- Create: `app/api/admin/users/[id]/route.ts`
- Test: `scripts/test-admin-users-api.ts`

**Step 1: Create `app/api/admin/users/route.ts`**
- `GET`: Authenticate user via `getCurrentUser(req)`. Ensure `isSuperAdmin(user)`. Support search query `q` and role filter `role`. Return list of users: `id, name, email, role, created_at, projects_count`.
- `POST`: Authenticate as Superadmin. Validate input: `name` (min 2 chars), `email` (valid format, unique), `password` (min 6 chars), `role` (`SUPERADMIN` | `ADMIN` | `USER`). Hash password with `hashPassword(password)`. Insert into `users`. Return created user.

**Step 2: Create `app/api/admin/users/[id]/route.ts`**
- `PUT`: Authenticate as Superadmin. Update user's name, email, role, and optional password (if provided).
- `DELETE`: Authenticate as Superadmin.
  - Guard 1: Cannot delete own account (`user.id === targetId`).
  - Guard 2: Cannot delete the last active `SUPERADMIN`.
  - Reassign or safely cascade any foreign key references.
  - Return `{ success: true }`.

**Step 3: Write test script**
Create `scripts/test-admin-users-api.ts` to test:
1. Non-superadmin access (returns 403 Forbidden).
2. Superadmin creating a test user.
3. Superadmin updating test user's role.
4. Superadmin deleting test user.

**Step 4: Run test script**
Run: `npx tsx -r dotenv/config scripts/test-admin-users-api.ts dotenv_config_path=.env.local`
Expected: All assertions PASS.

**Step 5: Commit**
```bash
git add app/api/admin/users/route.ts app/api/admin/users/[id]/route.ts scripts/test-admin-users-api.ts
git commit -m "feat(api): implement superadmin user management CRUD endpoints"
```

---

### Task 6: Superadmin User Management UI (`/users`) & Sidebar Integration

**Files:**
- Create: `app/users/page.tsx`
- Modify: `app/sidebar-nav.tsx`

**Step 1: Add "User Management" to `SidebarNav`**
In `app/sidebar-nav.tsx`:
If `user?.role === 'SUPERADMIN'`, render menu item:
```tsx
{ href: '/users', label: 'User Management', icon: Users }
```

**Step 2: Build `app/users/page.tsx`**
- **Header**: Title "User Management", subtitle "Manage user accounts, roles, and system access", and button `+ Add User`.
- **Metric Cards**:
  - Total Users
  - Superadmins
  - Administrators
  - Standard Users
- **Search & Filter Bar**:
  - Live search input (by name or email)
  - Role filter dropdown (`All Roles`, `SUPERADMIN`, `ADMIN`, `USER`)
- **Users Table**:
  - Columns: User (Name & Email), Role Badge (Superadmin: Purple, Admin: Indigo/Blue, User: Slate), Created Date, Actions (Edit, Delete).
- **Add / Edit User Modal**:
  - Form fields: Name, Email, Password (required on add, optional on edit), Role selector (`USER`, `ADMIN`, `SUPERADMIN`).
  - Loading & error states.
- **Delete Confirmation Dialog**:
  - Warning alert, confirmation button with loading state.
  - Disabled for current user's own account.

**Step 3: Test page rendering and client interactions**
Run: `npx tsc --noEmit`
Commit:
```bash
git add app/users/page.tsx app/sidebar-nav.tsx
git commit -m "feat(ui): add superadmin user management page and sidebar entry"
```

---

### Task 7: Full System Verification & Regression Test

**Files:**
- Test: All modified files and pages

**Step 1: Run type checking**
Run: `npx tsc --noEmit`
Expected: 0 errors.

**Step 2: Run production Next.js build**
Run: `npm run build`
Expected: Build succeeds with all pages static/dynamic compiled cleanly.

**Step 3: Verification Checklist**
- [ ] Log in as `raden@mail.com` $\rightarrow$ Header shows "Welcome Back, Raden Rizky".
- [ ] Log in as `superadmin@assetdetection.local` $\rightarrow$ Header shows "Welcome Back, Super Admin".
- [ ] Visit `/register` $\rightarrow$ Automatically redirected to `/login?notice=contact_admin`.
- [ ] "Daftar Sekarang" link removed from `/login`.
- [ ] Sidebar shows "Dashboard" instead of "Overview".
- [ ] Breadcrumbs display on `/projects` (`Dashboard > Projects`), `/legends` (`Dashboard > Legends`), `/users` (`Dashboard > User Management`).
- [ ] Superadmin can create, edit, and delete a user via `/users`.
- [ ] Standard user cannot see `/users` in sidebar and cannot access `/api/admin/users`.

**Step 4: Final commit**
```bash
git commit --allow-empty -m "chore: verified superadmin crud, greeting, and breadcrumbs"
```
