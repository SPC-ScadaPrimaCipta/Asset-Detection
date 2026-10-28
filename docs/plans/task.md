# Task Tracker: Superadmin User CRUD, Dynamic User Greeting, and Global Breadcrumbs

| Task ID | Task Description | Status |
|---|---|---|
| TASK-01 | Database migration (`sql/migrate-superadmin.sql`, `scripts/migrate-superadmin.ts`): users check constraint update and new Superadmin account seeding (`superadmin@assetdetection.local`) | DONE |
| TASK-02 | Auth helpers & public registration lockdown (`lib/auth.ts`, `middleware.ts`, `app/login/page.tsx`, `app/api/auth/register/route.ts`): add `isSuperAdmin` & `isPrivileged`, redirect `/register` to `/login`, remove self-register links | DONE |
| TASK-03 | User Context & Dynamic Greeting (`components/UserContext.tsx`, `app/layout.tsx`, `components/AppShell.tsx`, `components/Header.tsx`, `app/sidebar-nav.tsx`): display logged-in username in Header ("Welcome Back, [Username]") | DONE |
| TASK-04 | Global Breadcrumbs system & Sidebar rename (`components/Breadcrumbs.tsx`, `components/AppShell.tsx`, `app/sidebar-nav.tsx`): rename "Overview" to "Dashboard", auto-map route breadcrumbs | DONE |
| TASK-05 | Superadmin User Management API (`app/api/admin/users/route.ts`, `app/api/admin/users/[id]/route.ts`): endpoints for list, create, edit, delete user with guards | DONE |
| TASK-06 | Superadmin User Management UI (`app/users/page.tsx`, `app/sidebar-nav.tsx`): dedicated `/users` page with user table, search, filter, Add/Edit/Delete modals, and sidebar link | DONE |
| TASK-07 | Full system verification and build test (`npx tsc --noEmit`, `npm run build`, regression testing for ordinary users vs superadmin) | DONE |
