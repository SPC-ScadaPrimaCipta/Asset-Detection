# Design System — Automatic Assets Detection

## 1. Design Overview

**Product:** Automatic Assets Detection  
**Interface type:** Industrial document intelligence / P&ID & PFD analysis platform  
**Primary users:** Engineers, inspectors, asset integrity teams, reviewers, and administrators.

The interface should use a **minimalist, calm, technical dashboard aesthetic** inspired by the Nature skin of Vona by CodeThemes, while remaining an original design rather than a direct copy.

Reference:
- Vona Nature skin: https://themes.coderthemes.com/vona-angular/layouts/skin-nature
- Vona is currently positioned as a modern admin dashboard with responsive layouts, reusable UI components, charts, tables, forms, and light/dark support. The current Vona ecosystem also emphasizes minimal external dependencies and modular UI architecture.

### Core design principles

1. **Document-first** — PDF/P&ID content is the primary workspace.
2. **Minimal visual noise** — avoid excessive gradients, shadows, floating cards, and decorative elements.
3. **Engineering precision** — measurements, labels, symbols, coordinates, page numbers, and confidence values must be visually unambiguous.
4. **Fast interaction** — PDF viewing, detection review, filtering, and table operations should feel immediate.
5. **Consistent state language** — detected, reviewed, approved, rejected, uncertain, and processing states must always look consistent.
6. **Dense when necessary, spacious when possible** — dashboards can breathe; detection/review workspaces can be information-dense.
7. **Lightweight frontend** — avoid large all-in-one UI frameworks when a small composable component layer is sufficient.

---

# 2. Recommended Frontend UI Stack

The UI should be built from small composable primitives instead of a large monolithic component framework.

### Recommended

> **Status (terverifikasi 2026-10-02).** Tabel ini adalah rekomendasi awal.
> Yang benar-benar terpasang: **Tailwind CSS 4**, **Phosphor Icons**, **PDF.js**
> (`pdfjs-dist` via canvas, bukan `react-pdf`), **ExcelJS**, dan komponen UI
> buatan sendiri di `components/ui/` (`button`, `card`, `table`, `Modal`,
> `badge`, `input`, `Spinner`, `EmptyState`, `page-header`, `LegendSelector`).
>
> **Tidak terpasang:** shadcn/ui, Radix primitives, TanStack Table, Recharts,
> React Hook Form, Zustand, `react-pdf`. Tabel data dan form memakai React
> state + CSS biasa. Menambahkannya adalah keputusan terpisah, bukan default.
>
> Detail ikon: §34.

| Area | Technology | Purpose |
|---|---|---|
| Framework | Next.js / React | Application architecture |
| Styling | Tailwind CSS | Utility-first styling |
| UI primitives | shadcn/ui + Radix primitives | Accessible dialogs, dropdowns, tabs, popovers, menus, etc. |
| Icons | Phosphor Icons (`@phosphor-icons/react`) | Lightweight consistent icons |
| Data tables | TanStack Table | Sorting, filtering, pagination, column visibility |
| PDF | react-pdf + PDF.js | PDF rendering and page interaction |
| Charts | Recharts | Lightweight dashboard visualizations |
| Forms | React Hook Form + Zod | Forms and validation |
| State | Zustand or React state | Local UI/workspace state |
| Animation | CSS transitions / Motion only where needed | Avoid unnecessary animation overhead |

### Important performance rule

Do **not** install a complete UI framework such as Material UI, Ant Design, PrimeNG, or another large component suite if the project only needs a small subset of components.

The interface should primarily use:

```text
Tailwind CSS
    +
Phosphor Icons
    +
PDF.js
    +
components/ui primitives (button, card, table, Modal, badge, input, Spinner, EmptyState)
```

> shadcn/ui, Radix primitives, dan TanStack Table **tidak terpasang** — lihat catatan
> status di §"Recommended" di atas.

```text
(Target, belum terpasang)
Tailwind CSS
    +
shadcn/ui
    +
Radix primitives
    +
TanStack Table
    +
PDF.js
```

This keeps the visual system customizable and avoids shipping large amounts of unused UI code.

---

# 3. Visual Direction

## 3.1 Overall Character

The visual language should feel:

- Minimal
- Natural
- Technical
- Professional
- Quiet
- High precision
- Enterprise-ready
- Engineering-oriented

Avoid:

- Neon colors
- Excessive glassmorphism
- Large gradients
- Heavy shadows
- Excessive rounded cards
- Oversized typography
- Decorative illustrations in technical workflows

The Vona Nature reference uses a warm neutral canvas, dark green typography, thin borders, compact sidebar navigation, and restrained cards. This direction should be adapted to the Automatic Assets Detection domain.

---

# 4. Color System

## 4.1 Primary Palette

```css
--background: #F7F8F1;
--surface: #FBFCF7;
--surface-muted: #F0F2E9;

--foreground: #1F2A22;
--foreground-muted: #657066;
--foreground-subtle: #899189;

--primary: #002B4E;
--primary-hover: #001E38;
--primary-soft: #EAF3FA;

--accent: #0078B8;
--accent-hover: #005F94;
--accent-soft: #E8F6FC;

--border: #DDE2D8;
--border-strong: #C9D0C5;

--success: #8BBE3F;
--success-soft: #F0F8E8;

--warning: #A68145;
--warning-soft: #F4EBDD;

--danger: #A65A55;
--danger-soft: #F5E5E3;

--info: #617D91;
--info-soft: #E7EDF1;
```

## 4.2 Usage

| Color | Usage |
|---|---|
| `#F7F8F1` | Application background |
| `#FBFCF7` | Cards, panels, PDF workspace |
| `#002B4E` | Primary buttons, footer, dark bands, nav button |
| `#0078B8` | Active nav, links, category labels, active tabs |
| `#EAF3FA` | Soft CTA backgrounds, icon circles, pale bands |
| `#E8F6FC` | Icon backgrounds, badges, selected filters |
| `#8BBE3F` | Success checks, improvement indicators |
| `#F0F8E8` | Success backgrounds |
| `#DDE2D8` | Borders and separators |
| `#A68145` | Uncertain/warning state |
| `#A65A55` | Rejected/error state |
| `#617D91` | Information state |

### Color rule

Green should communicate **brand/primary**, not automatically mean "approved".

Detection status must have explicit labels in addition to color.

---

# 5. Typography

Use a clean sans-serif font.

Recommended:

```text
Inter
```

Fallback:

```text
system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif
```

## Type scale

| Element | Size | Weight |
|---|---:|---:|
| Page title | 24–28px | 600 |
| Section title | 17–20px | 600 |
| Card title | 13–15px | 600 |
| Body | 13–14px | 400 |
| Secondary text | 12–13px | 400 |
| Table text | 12–13px | 400–500 |
| Caption | 11–12px | 400 |
| Metric | 28–36px | 600–700 |

Technical values such as coordinates, IDs, confidence percentages, page numbers, and asset tags may use:

```text
JetBrains Mono
```

---

# 6. Layout

## 6.1 Desktop

Target:

```text
1440 × 900
```

Application structure:

```text
┌───────────────────────────────────────────────────────────────┐
│ Sidebar │ Topbar                                              │
│         ├─────────────────────────────────────────────────────┤
│         │                                                     │
│         │ Main Content                                        │
│         │                                                     │
│         │                                                     │
│         │                                                     │
└─────────┴─────────────────────────────────────────────────────┘
```

### Sidebar

Width:

```text
240px expanded
72px collapsed
```

Background:

```text
#F7F8F1
```

Border:

```text
1px solid #DDE2D8
```

The sidebar should resemble the supplied reference:

- compact
- vertically structured
- icon + label navigation
- subtle section labels
- small active indicator
- minimal separators

### Main content

Desktop horizontal padding:

```text
32px
```

Large desktop:

```text
40px
```

Content max width:

```text
1440px
```

Do not unnecessarily center narrow dashboard content.

---

# 7. Sidebar Navigation

Primary navigation:

```text
Dashboard

Projects

Detection

Review

Documents

Legends

Assets

Settings
```

Recommended grouping:

```text
WORKSPACE
├── Dashboard
├── Projects
├── Detection
└── Review

DOCUMENTS
├── Documents
└── Legends

DATA
└── Assets

SYSTEM
└── Settings
```

Each item:

- 32–40px height
- 8px horizontal padding
- 8px icon-to-label gap
- 6px radius
- muted inactive state
- dark green active state
- subtle soft-green active background

Active navigation:

```text
background: #EAF3FA
color: #002B4E
font-weight: 600
```

---

# 8. Topbar

Topbar height:

```text
64px
```

Contents:

```text
Breadcrumb / Page title
                    Search
                    Notifications
                    User menu
```

The topbar should remain visually quiet.

Recommended:

- no heavy shadow
- bottom border only
- sticky on document/review pages
- compact search field
- avatar dropdown

---

# 9. Dashboard

The Dashboard is an operational overview rather than a decorative analytics page.

## Header

```text
Automatic Assets Detection
Monitor projects, detection progress, review status, and asset extraction.
```

Actions:

```text
+ New Project
Import Document
```

## KPI cards

Use 4 cards:

```text
Projects
24

Documents
186

Detected Assets
4,821

Pending Review
137
```

Each card contains:

- label
- large metric
- small trend/status
- optional icon
- no excessive decoration

## Dashboard layout

```text
┌────────────┬────────────┬────────────┬────────────┐
│ Projects   │ Documents  │ Assets     │ Review     │
├────────────┴────────────┴────────────┴────────────┤
│ Detection Activity                                 │
│                                                    │
│ chart                                              │
├───────────────────────────────┬────────────────────┤
│ Recent Projects               │ Review Queue       │
│                               │                    │
├───────────────────────────────┴────────────────────┤
│ Recent Documents / Detection Activity              │
└────────────────────────────────────────────────────┘
```

### Charts

Use simple line/bar charts.

Avoid:

- 3D charts
- gradients
- excessive legends
- multiple unrelated colors

---

# 10. Projects Page

The Projects page is the primary project management view.

## Project card

Each card contains:

```text
Project Name
Project ID
Description

Documents      12
Assets         483
Review         38
Progress       76%

Last updated
[Open Project]
```

Actions dropdown:

```text
Open
Rename
Duplicate
Archive
Delete
```

## View modes

Provide:

```text
Grid
List
```

The default should be Grid.

Cards should remain compact and consistent.

---

# 11. Detection Page

Detection is the core computer-vision/document-analysis workspace.

## Recommended layout

```text
┌──────────────┬───────────────────────────────────────┐
│ Detection    │                                       │
│ Controls     │             PDF Viewer                │
│              │                                       │
│ Document     │                                       │
│ Page         │      detected symbols / boxes        │
│ Model        │                                       │
│ Confidence   │                                       │
│              │                                       │
│ Filters      │                                       │
└──────────────┴───────────────────────────────────────┘
```

### Left control panel

```text
Document
Page
Detection Model
Confidence Threshold
Asset Type
Status
Legend
```

Controls:

- Select
- Slider
- Checkbox
- Multi-select
- Toggle
- Dropdown

### Detection overlay

Detected objects should use precise overlays.

Example:

```text
┌──────────────────────┐
│ Pump P-101           │
│ 96.2%                │
└──────────────────────┘
```

Overlay requirements:

- thin bounding box
- small label
- confidence value
- asset type
- hover state
- selected state

Avoid large opaque rectangles that hide the drawing.

---

# 12. PDF Viewer Design

The PDF viewer is a critical component and should receive priority over decorative UI.

## Viewer structure

```text
┌─────────────────────────────────────────────────────┐
│ Page 4 / 18   − 100% +   Fit   Rotate   Download  │
├─────────────────────────────────────────────────────┤
│                                                     │
│                    PDF PAGE                         │
│                                                     │
│         detection overlays                         │
│                                                     │
├─────────────────────────────────────────────────────┤
│ Thumbnail │ Thumbnail │ Thumbnail │ Thumbnail      │
└─────────────────────────────────────────────────────┘
```

## Viewer toolbar

Required:

- Previous page
- Next page
- Page number
- Zoom out
- Zoom percentage
- Zoom in
- Fit width
- Fit page
- Rotate
- Fullscreen
- Search
- Download

Optional:

- Print
- Annotation mode
- Detection overlay toggle
- Legend toggle

## Performance

The PDF viewer must support:

- lazy page rendering
- virtualized thumbnails
- progressive loading
- rendering only visible pages
- canvas-based PDF rendering
- independent overlay layer

Do not render every page at full resolution simultaneously.

---

# 13. Detection Overlay Architecture

The PDF page should conceptually have multiple layers:

```text
PDF Canvas
    ↓
Text / Coordinate Layer
    ↓
Detection Overlay
    ↓
Selection Layer
    ↓
Annotation Layer
    ↓
Interaction Layer
```

Each detection should retain:

```text
asset_id
asset_type
page_number
x
y
width
height
confidence
status
source
```

This allows overlays to remain aligned when zooming.

### Coordinate rule

Detection coordinates must be stored in **PDF/document coordinates**, not raw browser pixels.

Rendering should transform:

```text
PDF coordinates
        ↓
viewport scale
        ↓
screen coordinates
```

This is essential for accurate marks/highlights at different zoom levels.

---

# 14. Review Page

Review is the human validation workspace.

Recommended layout:

```text
┌────────────────┬──────────────────────────────┐
│ Detection List │ PDF / P&ID Viewer            │
│                │                              │
│ P-101          │       highlighted asset      │
│ V-102          │                              │
│ HX-201         │                              │
│ ...            │                              │
├────────────────┼──────────────────────────────┤
│ Asset details  │ Review controls              │
└────────────────┴──────────────────────────────┘
```

## Review states

```text
Pending
Confirmed
Rejected
Needs Attention
```

Actions:

```text
Confirm
Reject
Edit
Merge
Split
Move
Add Asset
```

Keyboard shortcuts:

```text
Enter       Confirm
R           Reject
E           Edit
N           Next
P           Previous
Esc         Cancel
```

---

# 15. Documents Page

Documents should use a data-table-first design.

Columns:

```text
Name
Type
Pages
Project
Processing Status
Detection
Uploaded
Updated
Actions
```

Example status:

```text
Processing
Ready
Failed
Needs Review
```

Features:

- search
- column filters
- sorting
- pagination
- bulk selection
- column visibility
- upload
- drag-and-drop
- action dropdown

---

# 16. Data Table Design

Use TanStack Table with a custom visual layer.

The table should visually resemble the reference:

- thin borders
- warm neutral background
- compact rows
- subtle hover
- no heavy zebra stripes

Row height:

```text
44–52px
```

Header:

```text
12px
font-weight: 600
uppercase optional
```

Bulk toolbar appears only when rows are selected.

```text
3 selected

[Review] [Export] [Delete]
```

---

# 17. Legends Page

Legends explain detection symbols and annotation colors.

Layout:

```text
Legend Library

┌──────────────────────────────────────────────────┐
│ Legend Set                                       │
│                                                  │
│ ○ Pump             P-101                         │
│ ○ Valve            V-102                         │
│ ○ Heat Exchanger   HX-201                        │
│ ○ Vessel           V-301                         │
└──────────────────────────────────────────────────┘
```

Each legend entry:

- symbol preview
- asset category
- description
- detection color
- confidence rules
- visibility toggle

Support:

```text
Create Legend
Import Legend PDF
Edit Legend
Duplicate
Archive
```

---

# 18. Assets Page

Assets are the normalized output of detection.

## Asset table

Columns:

```text
Asset Tag
Asset Type
Description
Project
Document
Page
Confidence
Review Status
Updated
```

## Asset details drawer

Clicking an asset opens a right-side drawer:

```text
Asset Details

P-101

Type
Pump

Confidence
96.2%

Project
Plant A

Document
P&ID-001

Page
4

Coordinates
X 1042
Y 682

Review
Confirmed

[Open in PDF]
[Edit]
```

The PDF should automatically navigate to the asset's page and coordinates.

---

# 19. Settings

Settings should use a two-column layout:

```text
Settings navigation
│
├── General
├── Detection
├── PDF Viewer
├── Review
├── Notifications
├── Appearance
└── Users & Permissions
```

Use tabs only for closely related settings.

Avoid giant settings forms.

---

# 20. Cards

Cards should be lightweight.

Default:

```text
background: #FBFCF7
border: 1px solid #DDE2D8
border-radius: 8px
box-shadow: none
```

Hover:

```text
border-color: #C9D0C5
```

Avoid:

```text
large shadows
blur
glassmorphism
strong gradients
```

---

# 21. Buttons

## Primary

```text
Dark green background
White text
```

Example:

```text
+ New Project
```

## Secondary

```text
Transparent / surface background
Dark green text
Thin border
```

## Ghost

Used for:

- PDF toolbar
- icon actions
- table actions
- secondary navigation

## Destructive

Only use red for destructive actions.

---

# 22. Dropdowns

Dropdown menus should be compact.

Example:

```text
•••

Open
Edit
Duplicate
Export
────────────
Archive
Delete
```

Use icons only when they improve recognition.

---

# 23. Dialogs

Dialog dimensions:

```text
Small: 360–420px
Medium: 520–640px
Large: 720–960px
```

Use dialogs for:

- confirmation
- create/edit
- import
- configuration

Do not use dialogs for complex PDF workflows.

Use drawers or dedicated pages instead.

---

# 24. Drawers

Drawers are preferred for contextual information.

Example:

```text
┌─────────────────────────────┐
│ Asset Details           X   │
├─────────────────────────────┤
│                             │
│ P-101                       │
│ Pump                        │
│                             │
│ Confidence       96.2%      │
│ Page             4          │
│                             │
│ [Open in Viewer]            │
└─────────────────────────────┘
```

Width:

```text
400–480px
```

---

# 25. Status System

Use both icon/text and color.

| Status | Color | Meaning |
|---|---|---|
| Processing | Info | Analysis running |
| Ready | Success | Processing completed |
| Pending Review | Warning | Human review required |
| Confirmed | Success | Reviewer accepted |
| Rejected | Danger | Reviewer rejected |
| Failed | Danger | Processing failed |
| Needs Attention | Warning | Ambiguous result |

Never communicate a critical state using color alone.

---

# 26. Detection Confidence

Confidence should use a compact visual indicator.

Example:

```text
96.2%  ━━━━━━━━━━
```

Suggested semantic ranges:

```text
90–100%  High
70–89%   Medium
<70%     Low
```

The exact thresholds should be configurable by the detection pipeline rather than hardcoded into the UI.

---

# 27. Empty States

Empty states should be functional.

Example:

```text
No projects yet

Create your first project to start detecting assets
from P&ID and PFD documents.

[+ Create Project]
```

Avoid oversized illustrations.

---

# 28. Loading States

Use skeletons rather than spinners for page content.

Examples:

```text
Card skeleton
Table row skeleton
PDF page skeleton
Asset detail skeleton
```

For long-running detection:

```text
Processing document...

Page 12 / 48
Detected 382 assets

━━━━━━━━━━━━━━━━━━ 42%
```

---

# 29. Toast Notifications

Toast style should be compact.

Examples:

```text
✓ Detection completed
Document P&ID-001 processed successfully.
```

```text
! Review required
12 detections have low confidence.
```

Avoid stacking many notifications.

---

# 30. Responsive Design

## Desktop ≥ 1280px

Full sidebar + PDF workspace.

## Tablet 768–1279px

Sidebar collapses.

PDF workspace becomes:

```text
Controls
PDF
Details
```

using drawers.

## Mobile < 768px

The application should remain usable but does not need to reproduce the desktop detection workspace exactly.

Navigation becomes:

```text
Bottom navigation / mobile drawer
```

PDF controls become horizontally scrollable.

Detection details open as a bottom sheet.

---

# 31. PDF Viewer Responsive Behavior

Desktop:

```text
Sidebar | PDF | Details
```

Tablet:

```text
PDF
+
collapsible panels
```

Mobile:

```text
PDF
↓
Asset details bottom sheet
```

Never squeeze three desktop columns into a mobile viewport.

---

# 32. Spacing System

Use a 4px base unit.

```text
4px
8px
12px
16px
20px
24px
32px
40px
48px
64px
```

Typical card padding:

```text
16px
```

Dashboard section gap:

```text
24px
```

Major page section:

```text
32px
```

---

# 33. Border Radius

Use restrained rounding.

```text
Buttons: 6px
Inputs: 6px
Cards: 8px
Dialogs: 10px
Large workspace panels: 10px
Avatar: 50%
```

Avoid excessive pill-shaped components.

Pills should be reserved for:

- status badges
- filters
- compact tags

---

# 34. Icons

Use **Phosphor Icons** (`@phosphor-icons/react`).

> **Koreksi fakta (terverifikasi 2026-10-02).** Section ini sebelumnya
> menyebut "Lucide". Implementasi sebenarnya memakai `@phosphor-icons/react` di
> **seluruh** halaman: `app/detection`, `app/review`, `app/assets`,
> `app/projects`, `app/documents`, `app/legends/[id]/review`, dan
> `components/ui/LegendSelector.tsx`. `lucide-react` terpasang di
> `package.json` tetapi **tidak di-import di mana pun** — sisa dependensi.
>
> Nama ikon di contoh bawah adalah nama Lucide. Padanannya di Phosphor:

| Lucide (nama lama) | Phosphor (dipakai) |
|---|---|
| `LayoutDashboard` | `SquaresFour` |
| `FolderKanban` | `FolderPlus` |
| `CheckCircle2` | `CheckCircle` |
| `AlertCircle` | `Warning` |
| `ShieldCheck` | `SealCheck` |
| `Loader2` | `SpinnerGap` |
| `ChevronLeft` / `ChevronRight` | `CaretLeft` / `CaretRight` |
| `Plus` / `Minus` | `Plus` / `Minus` |
| `Pencil` | `PencilSimple` / `PencilLine` |
| `Save` | `FloppyDisk` |
| `Trash2` | `Trash` |
| `X` / `XCircle` | `X` / `XCircle` |
| `Undo2` | `ArrowCounterClockwise` |
| `Search` | `MagnifyingGlass` |
| `FileSpreadsheet` | `FileXls` |
| `Upload` | `UploadSimple` |
| `Zap` | `Lightning` |
| `PlusCircle` | `PlusCircle` |
| `Eye` | `Eye` |
| `ChevronDown` | `CaretDown` |

Examples:

```text
LayoutDashboard
FolderKanban
ScanSearch
ClipboardCheck
FileText
BookOpen
Boxes
Settings
Search
Filter
ZoomIn
ZoomOut
RotateCw
Maximize
MoreHorizontal
Check
X
AlertTriangle
```

Icon size:

```text
16px standard
18px navigation
20px major actions
```

Do not mix multiple icon families.

---

# 35. Animation

Animation should be subtle.

Use:

```text
150–200ms
ease-out
```

Good use cases:

- sidebar collapse
- dropdown
- drawer
- modal
- hover
- selection

Avoid:

- animated dashboards
- continuously moving PDF overlays
- large page transitions
- decorative motion

Respect:

```css
prefers-reduced-motion
```

---

# 36. Accessibility

Required:

- WCAG-conscious contrast
- keyboard navigation
- visible focus states
- semantic buttons
- ARIA labels for icon-only actions
- accessible dialogs
- accessible dropdowns
- keyboard PDF controls
- no color-only status communication

Focus ring:

```text
2px solid #0078B8
```

---

# 37. PDF / Detection Interaction Rules

These rules are critical.

### Rule 1 — Zoom independence

Changing PDF zoom must not change detection coordinates.

### Rule 2 — Overlay precision

Detection boxes must remain aligned with the original symbol at:

```text
50%
75%
100%
125%
150%
200%
```

### Rule 3 — Page independence

Switching pages must immediately remove the previous page's overlay layer.

### Rule 4 — Selection synchronization

Selecting an asset in the table must:

1. open its PDF page
2. center the viewport on the asset
3. highlight the detection
4. open asset details

### Rule 5 — PDF navigation synchronization

Clicking a detection in the PDF must:

1. select the asset
2. highlight its table row
3. update the details drawer

---

# 38. Dashboard Density

The Dashboard should visually resemble the supplied reference in density:

```text
Sidebar
    ↓
compact header
    ↓
4 KPI cards
    ↓
large primary chart
    ↓
secondary information panels
```

However, the content should be specific to Automatic Assets Detection.

Example:

```text
Detected Assets
4,821

Documents Processed
186

Detection Accuracy
94.3%

Pending Review
137
```

---

# 39. Design Tokens

Recommended CSS variables:

```css
:root {
  --background: 72 20% 96%;
  --foreground: 140 16% 15%;

  --surface: 72 25% 98%;
  --surface-muted: 75 18% 93%;

  --primary: 120 17% 24%;
  --primary-foreground: 72 25% 98%;

  --accent: 115 18% 61%;
  --accent-soft: 110 22% 91%;

  --border: 85 14% 87%;
  --border-strong: 85 12% 79%;

  --success: 128 18% 40%;
  --warning: 39 42% 46%;
  --danger: 5 34% 50%;
  --info: 205 20% 48%;

  --radius-sm: 6px;
  --radius-md: 8px;
  --radius-lg: 10px;

  --sidebar-width: 240px;
  --sidebar-collapsed-width: 72px;
  --topbar-height: 64px;
}
```

---

# 40. Component Architecture

Recommended component hierarchy:

```text
components/
├── layout/
│   ├── AppShell
│   ├── Sidebar
│   ├── Topbar
│   ├── Breadcrumbs
│   └── PageHeader
│
├── ui/
│   ├── Button
│   ├── Card
│   ├── Badge
│   ├── Dropdown
│   ├── Dialog
│   ├── Drawer
│   ├── Tabs
│   ├── Tooltip
│   ├── Input
│   ├── Select
│   └── Command
│
├── dashboard/
│   ├── MetricCard
│   ├── DetectionActivityChart
│   ├── RecentProjects
│   └── ReviewQueue
│
├── pdf/
│   ├── PdfViewer
│   ├── PdfToolbar
│   ├── PdfThumbnailPanel
│   ├── PdfOverlayLayer
│   ├── DetectionBox
│   └── PdfSearch
│
├── detection/
│   ├── DetectionPanel
│   ├── DetectionFilters
│   ├── DetectionList
│   ├── DetectionDetails
│   └── ConfidenceIndicator
│
├── review/
│   ├── ReviewWorkspace
│   ├── ReviewQueue
│   ├── ReviewActions
│   └── ReviewHistory
│
├── documents/
│   ├── DocumentTable
│   ├── DocumentUpload
│   └── DocumentActions
│
├── assets/
│   ├── AssetTable
│   ├── AssetDetails
│   └── AssetDrawer
│
└── legends/
    ├── LegendTable
    ├── LegendPreview
    └── LegendEditor
```

---

# 41. Page Structure

```text
/app
├── dashboard
├── projects
│   └── [projectId]
├── detection
│   └── [documentId]
├── review
│   └── [documentId]
├── documents
├── legends
├── assets
└── settings
```

The Detection and Review routes should share the same PDF workspace infrastructure.

---

# 42. Performance Requirements

Because the application contains PDF rendering and document analysis, UI performance is a first-class requirement.

### Required

- lazy-load PDF viewer
- dynamically import PDF.js components where appropriate
- virtualize large asset tables
- virtualize PDF thumbnails
- avoid rendering invisible detection overlays
- debounce search/filter input
- memoize expensive PDF calculations
- avoid unnecessary global state updates
- keep charts isolated from PDF state
- use server-side pagination for large datasets

### Target

Normal dashboard navigation should feel instant.

PDF interactions should remain responsive while detection results are loaded.

---

# 43. Dark Mode

Dark mode can be supported later, but the initial product should prioritize the light Nature-inspired theme.

Dark mode should not simply invert colors.

Future dark palette:

```text
Background: #151A16
Surface: #1B211C
Surface muted: #232A24
Foreground: #E8EEE7
Primary: #2E6FA6
Border: #303930
```

PDF content remains white/paper-like by default.

---

# 44. Design Do / Don't

## Do

- Use thin borders
- Use warm neutral backgrounds
- Use dark green as the main brand color
- Keep cards compact
- Use whitespace
- Use consistent 8px-ish radius
- Use precise engineering metadata
- Prioritize PDF readability
- Use drawers for contextual details
- Use tables for structured asset data

## Don't

- Do not copy Vona directly
- Do not use large gradients
- Do not use heavy shadows
- Do not use multiple UI frameworks
- Do not hide critical data inside excessive dialogs
- Do not use color alone for detection status
- Do not let overlays obscure P&ID symbols
- Do not render every PDF page simultaneously
- Do not make the dashboard look like a generic SaaS analytics product

---

# 45. Final Visual Target

The final interface should feel like:

```text
Vona Nature
     +
Engineering Document Viewer
     +
Computer Vision Detection Workspace
     +
Minimal Enterprise Asset Management
```

The visual hierarchy should be:

```text
1. PDF / engineering document
2. Detection result
3. Asset metadata
4. Review workflow
5. Analytics
6. Administrative controls
```

The interface should look **quiet and premium**, but the interaction model should be optimized for engineers working with large P&ID/PFD documents.

The design reference is used for the visual direction—especially its restrained nature palette, compact sidebar, thin borders, card density, and minimalist dashboard composition—not as a pixel-for-pixel clone.
