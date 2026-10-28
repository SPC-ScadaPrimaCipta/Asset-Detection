# Design Document: Superadmin User CRUD, Dynamic User Greeting, and Global Breadcrumbs

## 1. Context & Motivation
- **Greeting Issue**: Currently in `components/AppShell.tsx`, `<Header operatorName="Operator" />` is hardcoded. Even when a user logs in (e.g. Raden Rizky or Admin), the greeting shows "Welcome Back, Operator".
- **Registration & Role Control**: Any user can currently register freely at `/register`. We need central user control: introduce role `SUPERADMIN`, close public `/register`, and provide full User CRUD (Create, Read, Update, Delete) accessible exclusively to Superadmin.
- **Breadcrumbs**: Currently no breadcrumbs exist. Pages lack clear visual hierarchical breadcrumb trails.

## 2. Architecture & Components

### 2.1 Database Schema & Superadmin Account
```sql
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check 
  CHECK (role IN ('SUPERADMIN', 'ADMIN', 'USER'));

CREATE INDEX IF NOT EXISTS idx_users_role ON users(role);
```
- **New Superadmin Account**:
  A migration/seed script creates a new dedicated superadmin account:
  - Name: `Super Admin`
  - Email: `superadmin@assetdetection.local`
  - Password: `superadmin123` (hashed via `scrypt`)
  - Role: `SUPERADMIN`
  - Existing users (`admin@assetdetection.local` and `raden@mail.com`) retain their current roles.

### 2.2 Auth Helper (`lib/auth.ts`)
- Update `AuthUser.role`: `'SUPERADMIN' | 'ADMIN' | 'USER'`
- Add `isSuperAdmin(user)`: checks `user?.role === 'SUPERADMIN'`
- Add `isPrivileged(user)`: checks `user?.role === 'ADMIN' || user?.role === 'SUPERADMIN'`

### 2.3 Registration Locking
- `middleware.ts`: Redirect `/register` to `/login?notice=contact_admin`.
- `app/login/page.tsx`: Remove "Belum punya akun? Daftar Sekarang" link. Show notice if directed from register.
- `app/api/auth/register/route.ts`: Restrict to `isSuperAdmin(user)` or return 403.

### 2.4 User Context & Dynamic Greeting
- `components/UserContext.tsx`: Lightweight React context caching `/api/auth/me`.
- `components/AppShell.tsx`: Reads `useUser()` and passes `operatorName={user?.name || 'Operator'}` to `Header`.
- `components/Header.tsx`: Displays "Welcome Back," + user name.

### 2.5 Superadmin User CRUD (`/users`)
- Backend API:
  - `GET /api/admin/users`: List users (with search and role filter).
  - `POST /api/admin/users`: Create user (name, email, password, role).
  - `PUT /api/admin/users/[id]`: Update user (name, email, role, optional password).
  - `DELETE /api/admin/users/[id]`: Delete user (guarded: cannot delete self, cannot delete last superadmin).
- Frontend UI:
  - Route: `/users`
  - Stat cards: Total Users, Superadmins, Admins, Users.
  - Interactive Table with search and role filter.
  - Add User Modal, Edit User Modal, Delete Confirmation Dialog.
- Sidebar:
  - Update root menu label from **"Overview"** to **"Dashboard"** (href: `/`).
  - Display **"User Management"** link with `Users` icon if `user.role === 'SUPERADMIN'`.

### 2.6 Global Breadcrumbs (`components/Breadcrumbs.tsx`)
- Rendered in `components/AppShell.tsx` directly below `<Header />`.
- Root label is **"Dashboard"** (linking to `/`), e.g., `Dashboard > Projects`, `Dashboard > Legends > New Legend`.
- Automatically maps `pathname` to hierarchical paths with clean titles and clickable links.
- Uses subtle industrial styling with `Home` icon and `ChevronRight` separators.

