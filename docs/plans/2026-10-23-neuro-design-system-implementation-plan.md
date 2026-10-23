# Neuro Design System Transformation Implementation Plan

> **For Antigravity:** REQUIRED WORKFLOW: Use `.agents/workflows/execute-plan.md` to execute this plan in single-flow mode.

**Goal:** Transform the visual appearance and layout of the Automatic Asset Detection platform into the Neuro Design System (Royal Blue palette, Light & Dark mode support, Plus Jakarta Sans typography, 12-column dashboard grid, 28px frame radius) while strictly preserving 100% of existing functional logic, API calls, and backend integrations.

**Architecture:** Implement design tokens and theme variables in `app/globals.css` with a zero-flash theme provider. Standardize UI components in `components/ui/*` around Neuro radius and shadow tokens. Wrap the application in a 1440px desktop frame container with a 240px Royal Blue rounded sidebar and top header, and reconstruct `app/page.tsx` into Neuro's 8-column/4-column modular layout connected to existing `/api/stats` and `/api/quota` APIs.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, Tailwind CSS v4, Plus Jakarta Sans (`next/font/google`), Lucide React icons.

---

### Task 1: Design Tokens, CSS Variables & Typography Setup

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx:1-40`

**Step 1: Update `app/globals.css` with complete Neuro tokens**
Add `:root, [data-theme="light"]` and `[data-theme="dark"]` token sets for:
- `--primary: #3451D1` (light), `#5B7BFF` (dark)
- `--bg-page`, `--bg-app`, `--surface`, `--surface-2`, `--border`, `--text-primary`, `--text-secondary`, `--text-muted`
- `--sidebar-bg`, `--sidebar-item-active-bg`, `--sidebar-support-bg`
- `--banner-bg`, `--shadow-card`, `--shadow-frame`
- `--radius-frame: 28px`, `--radius-card: 20px`, `--radius-sidebar: 24px`, `--radius-button: 10px`, `--radius-input: 10px`, `--radius-chip: 6px`
- Global color transition: `transition: background-color 200ms ease, color 200ms ease, border-color 200ms ease`

**Step 2: Load Plus Jakarta Sans in `app/layout.tsx`**
Replace Geist with `Plus_Jakarta_Sans` from `next/font/google`:
```tsx
import { Plus_Jakarta_Sans } from "next/font/google";

const plusJakartaSans = Plus_Jakarta_Sans({
  variable: "--font-plus-jakarta",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
```

**Step 3: Verify build / typecheck**
Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

**Step 4: Commit**
```bash
git add app/globals.css app/layout.tsx
git commit -m "style: setup neuro design tokens and plus jakarta sans font"
```

---

### Task 2: Theme Switcher Component & Theme Management

**Files:**
- Create: `components/ThemeToggle.tsx`
- Create: `components/ThemeProvider.tsx`
- Modify: `app/layout.tsx`

**Step 1: Create `components/ThemeProvider.tsx`**
Client provider handling `theme` state (`'light' | 'dark' | 'system'`), reading initial preference from `localStorage.getItem('neuro-theme')` or system `prefers-color-scheme`, and applying `document.documentElement.setAttribute('data-theme', resolvedTheme)`.

**Step 2: Create `components/ThemeToggle.tsx`**
Compact button (40×40px or dropdown) with Sun/Moon icons, allowing toggle between Light, Dark, and System modes with accessible labels.

**Step 3: Embed in `app/layout.tsx`**
Include inline script in `<head>` to set initial `data-theme` synchronously before hydration to eliminate theme flicker.

**Step 4: Verify Theme Switching**
Run: `npm run build`
Expected: Build succeeds.

**Step 5: Commit**
```bash
git add components/ThemeToggle.tsx components/ThemeProvider.tsx app/layout.tsx
git commit -m "feat: add light and dark theme provider and toggle"
```

---

### Task 3: Standardize Reusable UI Components Library

**Files:**
- Modify: `components/ui/card.tsx`
- Modify: `components/ui/button.tsx`
- Modify: `components/ui/badge.tsx`
- Modify: `components/ui/input.tsx`
- Modify: `components/ui/table.tsx`
- Modify: `components/ui/Modal.tsx`

**Step 1: Update `card.tsx`**
Add Neuro Card styling:
- Radius: `20px` (`--radius-card`)
- Shadow: `var(--shadow-card)`
- Padding: `24px`
- Support header pattern: `iconBox` (16×16 Royal Blue square, 4px radius) + `H3` title (15px/600) + optional `action` (e.g. `⋮` menu).

**Step 2: Update `button.tsx`**
Add variants matching Design.md:
- `primary`: background `--primary` (`#3451D1`), white text, 44px height, 10px radius, hover `--primary-hover`
- `secondary`: background `#FFFFFF` (light) / `--surface-2` (dark), `--text-primary` text
- `accent`: background `--accent` (`#6CC8F2`), white text
- `icon`: 44×44px, radius 14px, background `--surface`
- Focus ring: `outline: 2px solid var(--primary); outline-offset: 2px`

**Step 3: Update `badge.tsx`**
Status chip styles with `--radius-chip: 6px`, 4px 12px padding:
- `success` / `available`: `--success-soft` bg + `--success` text
- `danger` / `pending`: `--danger-soft` bg + `--danger` text
- `primary`: `--primary-soft` bg + `--primary` text

**Step 4: Update `input.tsx` and `table.tsx`**
- Input: 44px height, `--radius-input: 10px`, `--surface-2` background, `--border` border, focus ring.
- Table: `--surface` background, `--border` dividers, `--surface-2` row hover, `font-variant-numeric: tabular-nums`.

**Step 5: Verify Component Compilation**
Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

**Step 6: Commit**
```bash
git add components/ui/*
git commit -m "style: standardize UI component library with neuro tokens"
```

---

### Task 4: App Shell Layout, Rounded Sidebar & Top Header

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/sidebar-nav.tsx`
- Create: `components/Header.tsx`

**Step 1: Construct Neuro Top Header in `components/Header.tsx`**
- Greeting: "Welcome Back," (`14px, --text-secondary`) + Operator title/name (`H1 28px/600 --text-primary`).
- Right actions:
  - Primary Button: `"Run Detection"` (links to `/detection`).
  - Search Input: 44px height, placeholder `"Search P&ID, tag, equipment..."`.
  - Notification Bell: 44×44 icon button with indicator badge.
  - Theme Toggle component.

**Step 2: Redesign Sidebar in `app/sidebar-nav.tsx`**
- Lebar 240px, tinggi penuh, `--radius-sidebar: 24px`, background `--sidebar-bg` (`#3451D1` light / `#1B2466` dark).
- Logo: 3D cube symbol + `"Neuro."` wordmark (white 700 24px) + subtitle `"Asset Detection"`.
- Menu items (preserving all active routes): Overview (`/`), Projects (`/projects`), Detection (`/detection`), Documents (`/documents`), Legends (`/legends`), Assets (`/assets`), MDO Flow (`/mdo`), Settings (`/settings`).
- Active item: White background (`#FFFFFF`) with dark text (`#1E2347`) and Royal Blue icon in light mode; high-contrast `#2B3786` in dark mode.
- Support Box at bottom: Status AI Engine & Provider, version info, quick help.

**Step 3: Wrap Main Frame in `app/layout.tsx`**
- Outer page: `--bg-page` gradient background with padding.
- Inner container: 1440px max-width, `--bg-app` frame, `--radius-frame: 28px`, `--shadow-frame`.
- Responsive breakpoints: 1280px full, 1024-1279px compact icon sidebar, <1024px drawer.

**Step 4: Verify App Shell**
Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

**Step 5: Commit**
```bash
git add app/layout.tsx app/sidebar-nav.tsx components/Header.tsx
git commit -m "feat: implement neuro app shell with 1440px frame, royal blue sidebar, and top header"
```

---

### Task 5: Main Dashboard Redesign (12-Column Grid Architecture)

**Files:**
- Modify: `app/page.tsx`
- Create: `components/dashboard/DetectionBanner.tsx`
- Create: `components/dashboard/Sparkline.tsx`
- Create: `components/dashboard/ActivityChart.tsx`
- Create: `components/dashboard/RecentDocumentsList.tsx`
- Create: `components/dashboard/VerificationStatusCard.tsx`

**Step 1: Create `DetectionBanner.tsx`**
- Background: `--banner-bg` gradient, radius 20px, padding 32px.
- Title: `"Automate Your P&ID Asset Extraction"` + subtitle.
- Secondary Button: `"Run New Detection"` (links to `/detection`).
- Graphic: Industrial 3D visual badge with depth effect.

**Step 2: Create `Sparkline.tsx` and Stat Cards**
- SVG sparkline with monotone curve and area gradient fill.
- Detected Assets Card (green trend `+10%`, sparkline).
- Pending Review Card (status trend, sparkline).

**Step 3: Create `ActivityChart.tsx`**
- SVG monotone smooth line & area chart matching Neuro "Latest Download" spec.
- 2.5px `--primary` stroke, 18% area gradient fill, horizontal grid lines, Y-axis (0-400), X-axis (Mon-Sun).
- Interactive tooltip on hover showing detection volume.

**Step 4: Create `RecentDocumentsList.tsx` (Top Right 4-cols)**
- List of 5 recent P&ID documents/projects.
- 44×44 pastel thumbnails (`#E3ECFF`, `#FFE9D6`, `#E3F7EE`, `#FFE4E4`, `#DDF4FA`).
- Document name, tag count, chevron `›`, `--surface-2` hover.

**Step 5: Create `VerificationStatusCard.tsx` (Bottom Right 4-cols)**
- 2-column comparison: Confirmed (Available chip) vs Pending (Needs Review chip).
- Full-width button: `"Review All Assets"` (links to `/assets` or `/mdo`).
- Footer: Active AI Provider balance & quota from `/api/quota`.

**Step 6: Integrate all components in `app/page.tsx`**
- Connect existing `useEffect` fetching `/api/stats` and `/api/quota`.
- Ensure 100% data fidelity with zero logic change.

**Step 7: Verify Dashboard Compilation**
Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

**Step 8: Commit**
```bash
git add app/page.tsx components/dashboard/*
git commit -m "feat: redesign main dashboard to neuro 12-column layout"
```

---

### Task 6: Visual Alignment of Secondary Pages

**Files:**
- Modify: `app/projects/page.tsx`
- Modify: `app/documents/page.tsx`
- Modify: `app/detection/page.tsx`
- Modify: `app/legends/page.tsx`
- Modify: `app/assets/page.tsx`
- Modify: `app/settings/page.tsx`
- Modify: `app/mdo/page.tsx`

**Step 1: Align Card and Table containers**
Ensure secondary pages use standard `Card`, `Button`, `Badge`, and `Table` components from `@/components/ui`, inheriting the Neuro styling and colors automatically.

**Step 2: Guard Functional Integrity**
Verify:
- P&ID / DXF viewer on `/detection` keeps all zoom, pan, and bounding box interactions.
- File upload on `/documents` keeps multipart FormData upload handling.
- Legend CRUD on `/legends` keeps tag patterns and symbol state.
- Asset register on `/assets` keeps search, status filtering, and Excel export.
- MDO workflow on `/mdo` keeps all 8 Accenture columns and live calculation.

**Step 3: Verify Type Safety**
Run: `npx tsc --noEmit`
Expected: PASS with 0 errors.

**Step 4: Commit**
```bash
git add app/projects/page.tsx app/documents/page.tsx app/detection/page.tsx app/legends/page.tsx app/assets/page.tsx app/settings/page.tsx app/mdo/page.tsx
git commit -m "style: align secondary pages with neuro card and table design"
```

---

### Task 7: Build, End-to-End Verification & Quality Gate

**Files:**
- Entire workspace

**Step 1: Run Next.js Production Build**
Run: `npm run build`
Expected: Next.js build succeeds with valid static and dynamic route generation.

**Step 2: Verify Theme Switching and LocalStorage**
- Test Light mode toggle.
- Test Dark mode toggle.
- Verify smooth transition (200ms) and persistence across page reloads.

**Step 3: Verify Feature Matrix**
- Test `/` Dashboard stats & quota display.
- Test `/detection` viewer & detection trigger.
- Test `/documents` upload flow.
- Test `/legends` symbol display.
- Test `/assets` table & export.
- Test `/mdo` 8-column editor.

**Step 4: Update Task Tracker**
Update `docs/plans/task.md` to reflect all completed tasks.

**Step 5: Final Commit**
```bash
git add docs/plans/task.md
git commit -m "docs: complete neuro design system transformation tasks"
```
