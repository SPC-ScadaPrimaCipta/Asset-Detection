# Auth, Multi-User Projects, Scoped Legends, and Clone/Share Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Add user authentication, private/public project isolation, project-scoped legends, and a hybrid clone/share mechanism with backward compatibility for existing data.

**Architecture:** PostgreSQL schema migration with default Admin user, lightweight native cookie sessions (`lib/auth.ts`), Next.js App Router API routes, and React UI components.

**Tech Stack:** Next.js 16, TypeScript, Node.js `crypto` (scrypt), PostgreSQL (`pg`), Tailwind CSS, Phosphor Icons.

---

### Task 1: Database Migration & Schema Setup

**Files:**
- Create: `sql/migrate-auth-and-visibility.sql`
- Create: `scripts/migrate-auth.ts`

**Step 1: Write migration SQL**
```sql
-- sql/migrate-auth-and-visibility.sql
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'USER' CHECK (role IN ('ADMIN', 'USER')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE')),
  ADD COLUMN IF NOT EXISTS share_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS cloned_from_id UUID REFERENCES projects(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_projects_owner ON projects(owner_id);
CREATE INDEX IF NOT EXISTS idx_projects_visibility ON projects(visibility);
CREATE INDEX IF NOT EXISTS idx_projects_share_code ON projects(share_code);

ALTER TABLE legends
  ADD COLUMN IF NOT EXISTS project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS owner_id UUID REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'PUBLIC' CHECK (visibility IN ('PUBLIC', 'PRIVATE'));

CREATE INDEX IF NOT EXISTS idx_legends_project ON legends(project_id);
```

**Step 2: Create runner script with Default Admin seeding & data migration**
Create `scripts/migrate-auth.ts` to execute SQL, insert default Admin user (`admin@assetdetection.local` / `admin123`), and populate existing `projects` and `legends` with `owner_id` pointing to Admin and `visibility = 'PUBLIC'`.

**Step 3: Run migration**
Run: `npx tsx --env-file=.env.local scripts/migrate-auth.ts`
Expected: Migration successful with admin seeded and existing records updated.

**Step 4: Commit**
```bash
git add sql/migrate-auth-and-visibility.sql scripts/migrate-auth.ts
git commit -m "feat(db): add migration for auth, project visibility, and scoped legends"
```

---

### Task 2: Core Authentication Logic (`lib/auth.ts`)

**Files:**
- Create: `lib/auth.ts`

**Step 1: Implement password hashing and token generation using native `crypto`**
- `hashPassword(password: string): Promise<string>` using `crypto.scrypt` + salt.
- `verifyPassword(password: string, hash: string): Promise<boolean>`.
- `createSessionToken(userId: string): string` with HMAC signature.
- `verifySessionToken(token: string): { userId: string } | null`.
- `getCurrentUser(req: Request | NextRequest): Promise<User | null>`.
- `setSessionCookie(token: string): string` (Set-Cookie header).

**Step 2: Verify unit test for auth helpers**
Create a test script or Jest test verifying hash, verify, token sign, and token decode.

**Step 3: Commit**
```bash
git add lib/auth.ts
git commit -m "feat(auth): implement native password hashing and session tokens"
```

---

### Task 3: Auth API Routes (`/api/auth/*`)

**Files:**
- Create: `app/api/auth/register/route.ts`
- Create: `app/api/auth/login/route.ts`
- Create: `app/api/auth/logout/route.ts`
- Create: `app/api/auth/me/route.ts`

**Step 1: Implement `POST /api/auth/register`**
- Validates name, email, password (min 6 chars).
- Checks duplicate email.
- Hashes password and inserts user into `users`.
- Returns user info with `Set-Cookie: session_token=...`.

**Step 2: Implement `POST /api/auth/login`**
- Validates credentials against `users`.
- Generates session token and returns `Set-Cookie`.

**Step 3: Implement `POST /api/auth/logout`**
- Clears session cookie (`Max-Age=0`).

**Step 4: Implement `GET /api/auth/me`**
- Reads cookie, queries current user profile (`id`, `name`, `email`, `role`).

**Step 5: Commit**
```bash
git add app/api/auth/
git commit -m "feat(api): add auth endpoints for login, register, logout, and me"
```

---

### Task 4: Auth UI Pages & Sidebar Integration

**Files:**
- Create: `app/login/page.tsx`
- Create: `app/register/page.tsx`
- Modify: `app/sidebar-nav.tsx`

**Step 1: Create Login Page (`app/login/page.tsx`)**
- Email & password inputs, submit button, error messages.
- Clean industrial design matching the existing theme (`var(--surface)`, `var(--primary)`).
- Link to register page.

**Step 2: Create Register Page (`app/register/page.tsx`)**
- Name, email, password inputs, submit button, error messages.

**Step 3: Update `app/sidebar-nav.tsx`**
- Fetch `/api/auth/me` on mount.
- Render user profile pill at the bottom of the sidebar (initials avatar, user name, role badge).
- Include Logout button.

**Step 4: Verify in browser**
Test login with `admin@assetdetection.local`, verify sidebar updates and logout clears session.

**Step 5: Commit**
```bash
git add app/login/page.tsx app/register/page.tsx app/sidebar-nav.tsx
git commit -m "feat(ui): add login and register pages and sidebar user status"
```

---

### Task 5: Project Visibility & Scoped Legend API

**Files:**
- Modify: `app/api/projects/route.ts`
- Modify: `app/api/projects/[id]/route.ts`
- Modify: `app/api/legends/route.ts`

**Step 1: Update `GET /api/projects`**
- Support query param `?filter=my` (returns private projects owned by user) vs `?filter=public` (returns public projects).
- Include `owner_name` via `LEFT JOIN users u ON p.owner_id = u.id`.

**Step 2: Update `POST /api/projects`**
- Assign `owner_id = currentUser.id`.
- Support `visibility: 'PUBLIC' | 'PRIVATE'`.
- Generate unique `share_code`.

**Step 3: Update `GET /api/legends`**
- Support query param `?project_id=<id>`.
- Returns: all Built-in Standard Legends (`is_builtin = true`) PLUS legends associated with `project_id`.

**Step 4: Commit**
```bash
git add app/api/projects/route.ts app/api/projects/[id]/route.ts app/api/legends/route.ts
git commit -m "feat(api): support project visibility filters and project-scoped legends"
```

---

### Task 6: Clone & Share Code API

**Files:**
- Create: `app/api/projects/[id]/clone/route.ts`
- Create: `app/api/projects/join-code/route.ts`

**Step 1: Implement `POST /api/projects/[id]/clone`**
- Validates user session.
- Starts PostgreSQL transaction `BEGIN`.
- Creates new project: `name = name + ' (Copy)'`, `owner_id = currentUser.id`, `visibility = 'PRIVATE'`, `cloned_from_id = id`.
- Duplicates `documents` & `document_pages` pointing to existing physical files in storage (no disk bloat).
- Duplicates project-specific `legends` & `legend_symbols`.
- Duplicates `detection_jobs` and `detections` so the user retains previous review status and bounding boxes.
- Commits transaction.

**Step 2: Implement `POST /api/projects/join-code`**
- Looks up project by `share_code`.
- Clones project into caller's workspace or returns project ID.

**Step 3: Commit**
```bash
git add app/api/projects/[id]/clone/route.ts app/api/projects/join-code/route.ts
git commit -m "feat(api): implement project cloning and join via share code"
```

---

### Task 7: Projects Page UI Overhaul

**Files:**
- Modify: `app/projects/page.tsx`
- Modify: `app/projects/[id]/page.tsx`

**Step 1: Update `app/projects/page.tsx`**
- Add Tab Switcher: **"My Workspace (Private)"** vs **"Public Projects"**.
- Add **"Join via Code"** modal.
- Render project cards with:
  - Creator label (`Created by <Name>` / `Admin`).
  - Visibility badge (`Private` / `Public`).
  - Action buttons: **"Clone to My Workspace"** (on Public), **"Share Code"** (on Private), **"Publish Copy"**.

**Step 2: Update project detail view (`app/projects/[id]/page.tsx`)**
- Display project metadata, owner, visibility, and share options.

**Step 3: Commit**
```bash
git add app/projects/page.tsx app/projects/[id]/page.tsx
git commit -m "feat(ui): update projects page with private/public tabs and clone/share actions"
```

---

### Task 8: Detection Page Scoped Legend Integration & Verification

**Files:**
- Modify: `app/detection/page.tsx`

**Step 1: Filter legend dropdown based on selected project**
- When a document is selected, retrieve its `project_id`.
- Fetch legends for that project (`/api/legends?project_id=${projectId}`).
- Populate legend select dropdown with Built-in Standard Legends + Project-specific Legends.

**Step 2: End-to-end verification**
- Test registering a new user.
- Clone a public project into private workspace.
- Open detection on cloned project, verify symbols and documents exist.
- Test share code between two accounts.
- Run `npm run build` and `npx tsc --noEmit`.

**Step 3: Commit**
```bash
git add app/detection/page.tsx
git commit -m "feat(detection): filter legends by active project and complete integration"
```
