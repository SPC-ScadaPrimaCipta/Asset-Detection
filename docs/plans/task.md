# Task Tracker: Auth, Multi-User Projects, Scoped Legends, and Clone/Share Mechanism

| Task ID | Task Description | Status |
|---|---|---|
| TASK-01 | Database migration (`sql/migrate-auth-and-visibility.sql`, `scripts/migrate-auth.ts`): users table, owner_id, visibility, share_code, scoped legends, admin seeding, and existing data migration to PUBLIC | DONE |
| TASK-02 | Core authentication logic (`lib/auth.ts`): password hashing with native `crypto.scrypt`, secure HTTP-only session cookies, token signing, and `getCurrentUser` helper | DONE |
| TASK-03 | Auth API routes (`/api/auth/register`, `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`) | DONE |
| TASK-04 | Auth UI pages (`/login`, `/register`) and sidebar user profile status + logout button (`app/sidebar-nav.tsx`) | DONE |
| TASK-05 | Project visibility & Scoped Legend backend API (filter public vs private, toggle visibility, project-scoped legends query) | DONE |
| TASK-06 | Clone & Share API: clone project to private workspace (`/api/projects/[id]/clone`), join via share code (`/api/projects/join-code`), and generate share code (`/api/projects/[id]/share-code`) | DONE |
| TASK-07 | Projects Page UI overhaul (`app/projects/page.tsx`): Private vs Public tabs, Creator badge, Clone to Private button, Share modal with share code generation & Make Public toggle | DONE |
| TASK-08 | Detection Page integration with scoped legends & End-to-end verification (`app/detection/page.tsx`, `npx tsc --noEmit`, `npm run build`) | DONE |
