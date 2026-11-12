# TagFlow — Automatic Asset Detection Platform

## 📋 Developer Handover Documentation

**Version:** 3.5  
**Last Updated:** November 2026  
**Original Developers:** Raden Rizky & Ihsan Alfarisi  
**Tech Stack:** Next.js 16, React 19, TypeScript 5, PostgreSQL 15, Redis, BullMQ

---

## 🎯 Project Overview

TagFlow adalah platform AI industri untuk deteksi otomatis simbol, peralatan (equipment), dan tag instrumen dari dokumen teknik P&ID (Piping & Instrumentation Diagram) dan DXF CAD drawings. Platform ini menghasilkan **Asset Register** dan **Material Data Origin (MDO)** standar enterprise yang siap digunakan untuk maintenance planning dan RBI (Risk-Based Inspection).

### **Problem Statement**

- Manual asset tagging dari P&ID memakan waktu 40+ jam per proyek
- Human error dalam identifikasi simbol dan tag
- Tidak ada standarisasi format output antar engineer
- Sulit tracking historical data dan versioning

### **Solution**

- AI-powered automatic detection (Google Gemini Vision, DeepSeek, Anthropic Claude, OpenAI)
- Multi-format support: PDF P&ID + DXF CAD files
- Interactive review workspace dengan bounding box visualization
- Standardized output: Excel Asset Register + 9-column MDO Accenture format
- Multi-user collaboration dengan project sharing

---

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Client (Next.js 16 App Router)            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐       │
│  │Dashboard │ │Projects  │ │Detection │ │   MDO    │       │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘       │
└─────────────────────────────────────────────────────────────┘
                            ↕ HTTP/WebSocket
┌─────────────────────────────────────────────────────────────┐
│              API Routes (Next.js Route Handlers)             │
│  /api/auth  /api/projects  /api/documents  /api/detections  │
│  /api/legends  /api/mdo  /api/settings  /api/admin          │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                    Business Logic Layer                      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │ PDF Renderer │  │ DXF Parser   │  │ AI Agent     │      │
│  │  (MuPDF)     │  │  (Custom)    │  │  (Gemini)    │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   NMS Dedup  │  │ Bbox Refine  │  │ MDO Builder  │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                  Background Processing                       │
│               BullMQ Worker + Redis Queue                    │
│  ┌──────────────────────────────────────────┐               │
│  │  Detection Jobs: PDF/DXF → AI → Review   │               │
│  │  Concurrency: 1 (free-tier safe)         │               │
│  └──────────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────────┘
                            ↕
┌─────────────────────────────────────────────────────────────┐
│                      Data Layer                              │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │PostgreSQL│  │  Redis   │  │File Store│  │  Cache   │   │
│  │  (20+    │  │  Queue   │  │ (Local/  │  │ (Redis)  │   │
│  │  tables) │  │          │  │  S3)     │  │          │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 📦 What Has Been Built (Development History)

### **Phase 1: Foundation**

**Developer: Raden Rizky**

#### **Core Infrastructure**

- ✅ Next.js 16 App Router setup dengan TypeScript strict mode
- ✅ PostgreSQL database design (20+ tables dengan relasi kompleks)
- ✅ Redis + BullMQ untuk async detection jobs
- ✅ File storage abstraction (local/S3 compatible)
- ✅ Idempotent migration system (`sql/migrate-*.sql`)

#### **Database Schema**

```sql
-- Core tables
users (auth & roles)
projects (private/public, share_code)
documents (PDF/DXF files)
document_pages (per-page metadata)
legends (symbol standards)
legend_symbols (symbol definitions dengan crop images)
detection_jobs (async job tracking)
detections (AI detection results)
detection_mdo_records (MDO 9-column data)

-- Supporting tables
settings (multi-provider AI config)
detection_audits (change tracking)
dxf_layer_profiles (CAD layer classification)
symbol_cache (legend matching cache)
```

#### **AI Integration**

- ✅ Google Gemini Vision 1.5 Pro/Flash integration
- ✅ Structured output dengan Zod schema validation
- ✅ Circuit breaker per-model untuk fault tolerance
- ✅ Rate limiting (15 RPM free tier safe)
- ✅ Retry logic dengan exponential backoff
- ✅ Cost tracking per detection job

---

### **Phase 2: Legend Management**

**Developer: Raden Rizky**

#### **Legend Upload & Extraction**

- ✅ Single-page PDF upload dengan strict validation
- ✅ AI automatic symbol extraction (bounding box + name)
- ✅ Multi-region parsing (2x2 grid untuk dense legends)
- ✅ Symbol cropping & storage untuk matching

#### **Legend Review Workspace**

- ✅ Interactive canvas dengan PDF.js viewer
- ✅ Bounding box edit: drag, resize, delete
- ✅ Keyboard shortcut: Delete/Backspace untuk remove bbox
- ✅ Quality status: VALIDATED / REVIEW / REJECTED
- ✅ Re-crop functionality dengan versioning
- ✅ Bulk validate semua symbols
- ✅ Atomic re-parse dengan confirmation modal

#### **Symbol Matching Engine**

- ✅ Vector embeddings untuk visual similarity
- ✅ Tag pattern matching (P-101, V-201, etc)
- ✅ Alias support per symbol
- ✅ Confidence scoring (0.0 - 1.0)

---

### **Phase 3: PDF Detection Pipeline**

**Developer: Raden Rizky**

#### **PDF Processing**

- ✅ MuPDF C++ binding untuk server-side rendering
- ✅ High-resolution page extraction (scale 4.0 untuk sharp images)
- ✅ PDF.js client-side viewer dengan smooth zoom/pan
- ✅ Mouse wheel zoom dengan dynamic high-DPI sizing

#### **AI Detection Workflow**

```typescript
// Simplified pipeline
PDF → Page Extract → High-Res Image → Gemini Vision
  → Structured JSON → Schema Validation → Bbox Normalization
  → Legend Matching → Confidence Scoring → DB Persist
  → Review UI
```

#### **Detection Features**

- ✅ Symbol detection dengan bounding box
- ✅ Tag extraction (OCR-free via AI)
- ✅ Type inference dari legend matching
- ✅ Spatial relationship analysis
- ✅ Description extraction (jika visible di P&ID)
- ✅ Evidence generation untuk setiap detection

---

### **Phase 4: DXF Detection Pipeline**

**Developer: Raden Rizky (primary), Ihsan Alfarisi (optimization)**

#### **DXF Parser**

- ✅ Custom DXF entity parser (INSERT, TEXT, MTEXT, CIRCLE, LINE, LWPOLYLINE, ARC)
- ✅ Layer classification (equipment, piping, text, annotation, construction)
- ✅ World coordinate system normalization
- ✅ Multi-sheet support (DXF tidak punya pages, simulated via regions)

#### **Hybrid Detection Strategy**

```typescript
// DXF detection combines 3 sources
1. Geometric Analysis (INSERT blocks, CIRCLE clusters, TEXT proximity)
2. AI Vision (render region to PNG → Gemini Vision)
3. Legend Matching (symbol + tag patterns)

→ Fusion algorithm → Final detections
```

#### **DXF Optimizations**

**Developer: Ihsan Alfarisi**

**Fix A: Aggressive Deduplication**

- Problem: V-0601 detected 21× dari berbagai sources
- Solution: `deduplicateByTag()` dengan source priority:
  - VISION(4) > INSERT(3) > ATTRIBUTE(2) > TEXT(1) > CIRCLE(0)
- Result: 432 PENDING → 150-180 (65% reduction)

**Fix B: Adaptive Bounding Box**

- Problem: 183/224 detections punya tiny bbox 8×8 pixels
- Solution: `minSize = max(30, medianTextHeight × 3)`
- Result: Representative geometry untuk P&ID viewer highlight

**Fix C: Confidence Separation**

- Tag exact + geometry + description → 0.88
- Tag exact + geometry → 0.85
- Text-only tanpa geometry → max 0.55
- Separates strong signals dari noise

**Fix D: Geometric Shape Inference**

- CIRCLE large (r > 5%) → Vessel
- DIAMOND pattern (4 lines) → Valve
- RECTANGLE narrow aspect → Tank
- ARC cluster → Heat Exchanger
- Upgrades UNKNOWN → typed equipment

**Fix E: Piping Graph Connectivity**

- `buildPidGraph()` trace LINE/LWPOLYLINE untuk network
- Equipment connected via pipes get +0.04 confidence boost
- Better than radius-only spatial proximity

**Result: F1 Score 0.26 → 0.75-0.80** (65% accuracy improvement)

---

### **Phase 5: Detection Workspace**

**Developer: Raden Rizky, Ihsan Alfarisi**

#### **Interactive Viewer**

- ✅ Split layout: Canvas (left) + Sidebar detection list (right)
- ✅ Bounding box rendering dengan color-coded status
- ✅ Click bbox → highlight di sidebar (sync selection)
- ✅ Asset label overlay dengan tag + type
- ✅ Zoom/pan controls
- ✅ Page navigation untuk multi-page PDFs
- ✅ Sheet switching untuk DXF multi-region

#### **Review Actions**

- ✅ **Approve**: Mark detection sebagai CONFIRMED
- ✅ **Reject**: Remove false positive
- ✅ **Edit**: Update tag, type, description, bbox
- ✅ **Re-crop**: Draw new bbox via canvas
- ✅ **Manual Add**: Draw bbox untuk missed assets
- ✅ **Deduplicate**: NMS algorithm untuk remove duplicates

#### **Deduplication Engine**

**Developer: Ihsan Alfarisi**

- ✅ NMS (Non-Maximum Suppression) dengan IoU threshold
- ✅ Preview modal dengan before/after comparison
- ✅ Badge counter menunjukkan jumlah duplicates
- ✅ Safe removal dengan undo capability
- ✅ Scope: per-document atau per-region
- ✅ Type-agnostic (works untuk semua asset types)

#### **Manual Asset Detection**

**Developer: Ihsan Alfarisi**

- ✅ Drawing mode: click & drag untuk mark area
- ✅ Green overlay rectangle saat drawing
- ✅ `AddManualAssetModal` untuk input detail
- ✅ Support PDF dan DXF
- ✅ World coordinates untuk DXF spatial accuracy
- ✅ API endpoint: `POST /api/detections/manual`

---

### **Phase 6: MDO System**

**Developer: Ihsan Alfarisi**

#### **Material Data Origin (MDO)**

Standar PT Accenture untuk process flow documentation.

**9-Column Structure:**

1. **Location Prefix** (e.g., "1C-")
2. **Tag No Proposed** (e.g., "V-0601")
3. **Equipment Type Short** (e.g., "VALVE")
4. **Equipment Name** (e.g., "Control Valve")
5. **Size** (e.g., "2 INCH")
6. **From** (upstream source)
7. **To** (downstream destination)
8. **Of** (fluid/medium)
9. **At** (conditions: pressure/temp)

#### **MDO Builder Engine**

```typescript
// 5-Step Fallback Chain
1. Direct AI Vision extraction (render region → Gemini)
2. Geometric parsing (3-pass: prefix, inline, SIZE_RE)
3. Spatial proximity analysis (nearby text tokens)
4. Piping network connectivity (graph traversal)
5. Legend description fallback

→ Fuse all sources → Build description string
```

#### **MDO Features**

- ✅ Auto-sync on GET request + window focus
- ✅ Manual refresh button
- ✅ Strict filtering: only APPROVED detections
- ✅ Rejected assets auto-removed dari MDO
- ✅ Excel export dengan 9-column format
- ✅ Approval workflow per-record
- ✅ DXF full support (sama treatment dengan PDF)

#### **AI Vision for DXF MDO**

**Problem:** FROM/TO/OF/AT fields often empty di DXF pure-geometric detection.

**Solution (October 2026):**

- Render DXF region to PNG dengan `renderDxfRegionToPng()`
- Pass ke Gemini Vision sama seperti PDF
- Fuse AI result dengan geometric parsing
- 5-step fallback chain ensures completeness
- Detailed logging per-region untuk debugging

---

### **Phase 7: Authentication & Multi-User**

**Developer: Ihsan Alfarisi**

#### **Authentication System**

- ✅ Native bcrypt password hashing (no external auth)
- ✅ JWT session tokens dengan HttpOnly cookies
- ✅ Login/Register pages dengan Neuro design
- ✅ Middleware protection semua app routes
- ✅ `/api/auth/login`, `/api/auth/logout`, `/api/auth/me`

#### **Role-Based Access Control (RBAC)**

```typescript
enum Role {
  SUPERADMIN  // Full system access + user management
  USER        // Normal engineer access
}
```

#### **Project Visibility**

- ✅ **Private Projects**: Only owner can see
- ✅ **Public Projects**: All users can view
- ✅ **Share Code**: 8-character code untuk invite users
- ✅ **Clone**: User bisa clone public project ke workspace sendiri

#### **Superadmin Features**

**Developer: Ihsan Alfarisi**

- ✅ User CRUD: Create, Read, Update, Delete users
- ✅ Reset password untuk users lain
- ✅ Activate/Deactivate user accounts
- ✅ Role management (promote/demote)
- ✅ UI: `/users` page dengan table + form
- ✅ API: `/api/admin/users` endpoints
- ✅ Seed script: `scripts/seed-users.ts`
  - superadmin@example.com / superadmin123
  - admin@example.com / admin123
  - user@example.com / user123

---

### **Phase 8: Multi-Provider AI**

**Developer: Raden Rizky, Ihsan Alfarisi**

#### **Supported Providers**

- ✅ **Google Gemini** (gemini-1.5-pro, gemini-1.5-flash)
- ✅ **DeepSeek** (deepseek-chat — text-only, no vision)
- ✅ **Anthropic Claude** (claude-3-5-sonnet, claude-3-opus)
- ✅ **OpenAI** (gpt-4o, gpt-4-turbo, gpt-4o-mini)
- ✅ **Custom Gateway** support (Azure OpenAI, self-hosted)

#### **Configuration UI**

- ✅ Tabbed interface per provider
- ✅ Live model scanner (fetch available models via API)
- ✅ API key storage encrypted di database
- ✅ Active model selection per use-case:
  - Legend extraction
  - Symbol detection
  - MDO enrichment
- ✅ Advanced tuning collapsed (cleaner UX)
- ✅ Dynamic engine info di sidebar

#### **Fallback Chain**

```typescript
// If primary model fails:
Primary (Gemini Pro) → Fallback (Gemini Flash) → Fallback (Claude)
→ Error notification + circuit breaker activation
```

---

### **Phase 9: UI/UX Overhaul - Neuro Design System**

**Developer: Raden Rizky**

#### **Design Tokens**

```css
--primary: #3451d1 (Royal Blue) --font: Plus Jakarta Sans --radius-frame: 28px
  --radius-card: 20px --shadow-card: 0 8px 24px rgba(52, 81, 209, 0.08);
```

#### **Components Built**

- ✅ **Sidebar**: Royal Blue gradient, collapsible, icon-only mode
- ✅ **Topbar**: User greeting, breadcrumbs, theme toggle
- ✅ **Card**: Rounded 20px dengan soft shadow
- ✅ **Button**: 10px radius, primary/secondary/danger variants
- ✅ **Badge**: Status indicators (PENDING/CONFIRMED/REJECTED)
- ✅ **Modal**: Blur backdrop, smooth animation
- ✅ **Table**: Sticky header, hover row, pagination
- ✅ **StatCard**: Dashboard metrics dengan sparkline

#### **Theme System**

- ✅ Light mode (default)
- ✅ Dark mode dengan auto CSS variable swap
- ✅ Smooth 200ms transition
- ✅ Persistent via localStorage

#### **Responsive Design**

**Developer: Ihsan Alfarisi**

- ✅ Breakpoints: 768px tablet, 480px mobile
- ✅ Detection sidebar stacks below canvas di mobile
- ✅ Tables horizontal scroll
- ✅ Touch-friendly buttons (44px minimum)
- ✅ iOS zoom prevention (16px input font)
- ✅ Modal full-width pada mobile

---

### **Phase 10: Export & Reporting**

**Developer: Raden Rizky**

#### **Asset Register Excel (5 Sheets)**

```
Sheet 1: Asset Register (main data)
Sheet 2: Equipment Summary (counts by type)
Sheet 3: Detection Summary (confidence distribution)
Sheet 4: Legend Used (symbol reference)
Sheet 5: Detection Evidence (AI reasoning per asset)
```

**Features:**

- ✅ Professional styling dengan header freeze
- ✅ Auto-filter enabled
- ✅ Column width optimization
- ✅ Percentage format untuk confidence
- ✅ Border styling
- ✅ Excel table structure

#### **MDO Excel Export**

- ✅ 9-column Accenture standard
- ✅ Only APPROVED assets included
- ✅ Sorted by location prefix + tag number
- ✅ Formula-friendly format
- ✅ Ready for ERP import

---

### **Phase 11: Documentation & User Guide**

**Developer: Ihsan Alfarisi**

#### **In-App User Guide (`/guide`)**

- ✅ Sticky Table of Contents dengan scroll spy
- ✅ Step-by-step workflow explanation
- ✅ Project sharing tutorial
- ✅ MDO workflow guide
- ✅ Screenshots dan code examples
- ✅ Troubleshooting section
- ✅ FAQ

#### **Technical Documentation**

```
docs/
├── design/                    (Design specs)
│   ├── auth-and-project-visibility.md
│   ├── superadmin-crud-greeting-breadcrumbs.md
│   ├── manual-asset-detection.md
│   └── legend-qa-revisions.md
├── plans/                     (Implementation plans)
│   ├── auth-implementation-plan.md
│   ├── superadmin-implementation-plan.md
│   └── legend-qa-implementation-plan.md
├── DXF_DETECTION_RESEARCH.md  (Deep research + improvement plan)
├── ASSET_REGISTER_EXCEL_EXPORT.md
├── AI_ROUTING_GUIDE.md        (Multi-provider routing)
└── Design.md                  (Design system tokens)
```

---

## 🔧 Technical Debt & Known Issues

### **High Priority**

1. **DXF text extraction**: OCR fallback untuk blurry/embedded text
2. **Large file handling**: Streaming upload untuk PDF > 50MB
3. **Batch processing**: Multi-document detection dalam 1 job
4. **Real-time progress**: WebSocket untuk live job updates (saat ini polling)

### **Medium Priority**

5. **Legend versioning**: Track symbol definition changes
6. **Detection history**: Audit trail untuk review edits
7. **Export templates**: Custom Excel templates per client
8. **Backup/restore**: Database backup automation

### **Low Priority**

9. **Mobile app**: React Native untuk field usage
10. **Offline mode**: Service worker untuk disconnected work
11. **API documentation**: OpenAPI/Swagger spec
12. **Performance profiling**: Lighthouse CI integration

---

## 🚀 Getting Started (For New Developers)

### **Prerequisites**

```bash
Node.js >= 20.x
PostgreSQL >= 14
Redis >= 6
Git
```

### **Installation**

```bash
# Clone repository
git clone https://github.com/RadenRizky26/Asset-Detection.git
cd Asset-Detection

# Install dependencies
npm install

# Setup environment variables
cp .env.example .env.local
# Edit .env.local dengan database credentials dan API keys

# Run migrations
npm run migrate

# Seed initial data (optional)
npx tsx --env-file=.env.local scripts/seed-users.ts

# Start development
npm run dev          # Web server (port 3000)
npm run worker       # Background worker (terminal 2)
```

### **Environment Variables**

```env
# Database
DATABASE_URL=postgresql://user:pass@localhost:5432/asset_detection

# Redis
REDIS_URL=redis://127.0.0.1:6379

# Authentication
JWT_SECRET=your-secret-key-min-32-chars

# AI Providers
GEMINI_API_KEY=AIzaSy...
OPENAI_API_KEY=sk-...
ANTHROPIC_API_KEY=sk-ant-...
DEEPSEEK_API_KEY=sk-...

# Storage (local default)
STORAGE_PATH=./storage

# Worker
WORKER_CONCURRENCY=1  # Free tier safe
```

---

## 📁 Project Structure

```
Asset-Detection/
├── app/                          # Next.js App Router
│   ├── api/                      # API Routes
│   │   ├── auth/                 # Authentication endpoints
│   │   ├── admin/                # Superadmin CRUD
│   │   ├── projects/             # Project management
│   │   ├── documents/            # Document upload/management
│   │   ├── legends/              # Legend CRUD + symbol operations
│   │   ├── detections/           # Detection operations
│   │   │   ├── manual/           # Manual asset addition
│   │   │   └── deduplicate/      # Deduplication
│   │   ├── mdo/                  # MDO workspace
│   │   └── settings/             # AI provider config
│   ├── (pages)/                  # UI Pages
│   │   ├── page.tsx              # Dashboard
│   │   ├── login/                # Login page
│   │   ├── projects/             # Projects list
│   │   ├── documents/            # Documents upload
│   │   ├── legends/              # Legend library
│   │   │   └── [id]/review/      # Legend review workspace
│   │   ├── detection/            # Detection workspace (main)
│   │   ├── mdo/                  # MDO workspace
│   │   ├── users/                # Superadmin user management
│   │   ├── settings/             # Settings page
│   │   └── guide/                # User guide
│   └── globals.css               # Global styles + design tokens
│
├── components/                   # React Components
│   ├── ui/                       # Reusable UI components
│   │   ├── Button.tsx
│   │   ├── Card.tsx
│   │   ├── Badge.tsx
│   │   ├── Modal.tsx
│   │   ├── Breadcrumbs.tsx
│   │   └── UserMenu.tsx
│   ├── detection/                # Detection-specific components
│   │   ├── AddManualAssetModal.tsx
│   │   └── DedupModal.tsx
│   ├── legends/                  # Legend-specific components
│   │   └── UploadLegendModal.tsx
│   ├── dashboard/                # Dashboard components
│   │   ├── DetectionBanner.tsx
│   │   ├── Sparkline.tsx
│   │   └── ActivityChart.tsx
│   ├── DxfViewer.tsx             # DXF canvas viewer
│   ├── Sidebar.tsx               # App sidebar
│   ├── Header.tsx                # App header
│   └── ThemeProvider.tsx         # Theme context
│
├── lib/                          # Business Logic
│   ├── db.ts                     # PostgreSQL client
│   ├── redis.ts                  # Redis client
│   ├── queue.ts                  # BullMQ queue setup
│   ├── storage.ts                # File storage abstraction
│   ├── auth.ts                   # Password hashing, JWT
│   ├── middleware.ts             # Auth middleware
│   │
│   ├── dxf-parser.ts             # DXF entity parser
│   ├── dxf-detection.ts          # DXF detection engine (Fix A-E)
│   ├── dxf-bbox-estimator.ts     # Bbox estimation
│   ├── dxf-renderer.ts           # DXF to PNG renderer
│   ├── piping-parser.ts          # Piping graph builder
│   │
│   ├── pdf-processor.ts          # MuPDF PDF processing
│   ├── legend-extract.ts         # Legend AI extraction
│   ├── legend-schemas.ts         # Legend validation schemas
│   │
│   ├── ai-agent.ts               # AI agent runner
│   ├── ai-config.ts              # Multi-provider config
│   ├── ai-schemas.ts             # Zod output schemas
│   ├── ai-circuit-breaker.ts     # Circuit breaker
│   ├── ai-generation.ts          # Generation configs
│   ├── gemini.ts                 # Gemini client
│   ├── model-resolver.ts         # Model discovery
│   ├── tuning.ts                 # Tuning parameters
│   │
│   ├── mdo-enrichment.ts         # MDO 5-step fallback
│   ├── mdo-pid-rules.ts          # MDO 3-pass parsing
│   ├── excel-export.ts           # Excel Asset Register
│   │
│   └── detection/                # Detection algorithms
│       ├── nms-deduplication.ts  # NMS algorithm
│       ├── nms-pipeline.ts       # Dedup pipeline
│       ├── bbox-refinement.ts    # Bbox refinement
│       ├── component-hierarchy.ts # Hierarchy detection
│       ├── geometry-inference.ts  # Shape-based type inference
│       └── hybrid-pipeline.ts    # DXF+AI fusion
│
├── workers/                      # Background Workers
│   └── detection-worker.ts       # BullMQ detection worker
│
├── sql/                          # Database Migrations
│   ├── init.sql                  # Initial schema (20 tables)
│   └── migrate-*.sql             # Incremental migrations (idempotent)
│
├── scripts/                      # Utility Scripts
│   ├── seed-users.ts             # Seed default users
│   ├── rerun-dxf-detection.ts    # DXF testing script
│   └── benchmark-gemini.ts       # Accuracy benchmark
│
├── docs/                         # Documentation
│   ├── design/                   # Design specs
│   ├── plans/                    # Implementation plans
│   ├── DXF_DETECTION_RESEARCH.md
│   └── USER_GUIDE.md
│
├── public/                       # Static Assets
│   ├── pdf.worker.min.mjs        # PDF.js worker
│   └── fonts/                    # Plus Jakarta Sans
│
├── __tests__/                    # Tests (excluded from build)
│
├── .env.example                  # Environment template
├── .gitignore
├── next.config.js
├── tsconfig.json
├── package.json
└── README.md
```

---

## 🧪 Testing Strategy

### **Manual Testing Checklist**

```
□ Login/Logout flow
□ Create private project
□ Upload legend (single-page PDF)
□ Review legend symbols
□ Upload document (PDF + DXF)
□ Run detection
□ Review detections (approve/reject/edit)
□ Add manual asset
□ Deduplicate
□ Export Asset Register
□ Generate MDO
□ Clone public project
□ Share project via code
```

### **Automated Tests**

```bash
# Unit tests (currently minimal)
npm test

# Type checking
npm run type-check

# Lint
npm run lint
```

### **Performance Benchmarks**

- PDF detection (10-page): ~45 seconds
- DXF detection (500 entities): ~30 seconds
- Legend extraction (50 symbols): ~20 seconds
- Excel export (1000 assets): ~3 seconds

---

## 🔐 Security Considerations

### **Implemented**

- ✅ Password hashing dengan bcrypt (cost 10)
- ✅ JWT HttpOnly cookies (no localStorage)
- ✅ SQL injection protection via parameterized queries
- ✅ File upload validation (MIME type, size, extension)
- ✅ API route authentication middleware
- ✅ Role-based access control (RBAC)
- ✅ Encrypted API keys di database

### **TODO**

- ⚠️ Rate limiting per-user (currently per-worker)
- ⚠️ CSRF tokens untuk state-changing operations
- ⚠️ Content Security Policy (CSP) headers
- ⚠️ File virus scanning sebelum processing
- ⚠️ Audit logging untuk sensitive operations

---

## 🐛 Debugging Tips

### **Common Issues**

**1. "Detection stuck in PROCESSING"**

```bash
# Check worker logs
npm run worker

# Check Redis queue
redis-cli
> KEYS bull:detection:*
> HGETALL bull:detection:active
```

**2. "Gemini API error 429 (Rate Limit)"**

- Free tier limit: 15 RPM
- Solution: Wait 1 minute atau upgrade to paid tier
- Circuit breaker akan auto-activate selama 5 menit

**3. "Database migration failed"**

```bash
# Check current migration status
psql -d asset_detection -c "SELECT * FROM schema_migrations;"

# Rollback manual (jika perlu)
psql -d asset_detection -f sql/rollback-migration-XXX.sql

# Re-run
npm run migrate
```

**4. "DXF detection confidence too low"**

- Check `lib/dxf-detection.ts` tuning parameters:
  - `DXF_DEDUP_MERGE_DIST` (default 40, lenient 150)
  - `DXF_MIN_BBOX_SIZE` (default 20, lenient 10)
- Enable debug logging: `DEBUG=dxf:* npm run worker`

**5. "MDO FROM/TO/OF/AT fields empty"**

- Check AI Vision enabled di `.env`: `ENABLE_DXF_AI_VISION=true`
- Verify Gemini API key valid
- Check logs untuk AI extraction result
- Fallback chain: AI → Geometric → Spatial → Graph → Legend

---

## 📊 Performance Optimization Guide

### **Database Optimization**

```sql
-- Add indexes untuk frequently queried columns
CREATE INDEX idx_detections_document_job ON detections(document_id, job_id);
CREATE INDEX idx_detections_status ON detections(review_status, detection_status);
CREATE INDEX idx_documents_project ON documents(project_id);
CREATE INDEX idx_legend_symbols_legend ON legend_symbols(legend_id, quality_status);

-- Vacuum regularly
VACUUM ANALYZE;
```

### **Redis Optimization**

```bash
# Monitor memory usage
redis-cli INFO memory

# Clear old job data (retention policy)
redis-cli --scan --pattern "bull:detection:*" | xargs redis-cli DEL
```

### **Image Processing**

- PDF render scale: 4.0 (balance antara quality vs file size)
- DXF region size: max 2000×2000 pixels
- Symbol crops: max 200×200 pixels
- Compression: JPEG 85% quality

### **AI Request Batching**

- Group symbols per legend extraction (max 50 per request)
- Parallel region processing untuk DXF (concurrency 2)
- Cache legend matching results (TTL 1 hour)

---

## 🔄 Deployment Guide

### **Production Environment Setup**

**1. Server Requirements**

```
CPU: 4+ cores (untuk parallel processing)
RAM: 8GB minimum (16GB recommended)
Storage: 100GB+ SSD
OS: Ubuntu 22.04 LTS atau Windows Server 2022
```

**2. Dependencies Installation**

```bash
# PostgreSQL
sudo apt install postgresql-14
sudo systemctl enable postgresql

# Redis
sudo apt install redis-server
sudo systemctl enable redis

# Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install nodejs

# PM2 (process manager)
npm install -g pm2
```

**3. Application Deployment**

```bash
# Clone & build
git clone https://github.com/RadenRizky26/Asset-Detection.git
cd Asset-Detection
npm ci --production
npm run build

# Setup environment
cp .env.example .env.production
nano .env.production  # Edit dengan production credentials

# Run migrations
DATABASE_URL="postgresql://..." npm run migrate

# Start application
pm2 start ecosystem.config.js
pm2 save
pm2 startup  # Auto-start on reboot
```

**4. Reverse Proxy (Nginx)**

```nginx
server {
    listen 80;
    server_name tagflow.yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

**5. SSL Certificate**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d tagflow.yourdomain.com
```

**6. Monitoring**

```bash
# PM2 monitoring
pm2 monit

# PostgreSQL connection pool
psql -c "SELECT * FROM pg_stat_activity;"

# Redis monitoring
redis-cli MONITOR

# Application logs
pm2 logs asset-detection --lines 100
```

---

## 🤝 Contributing Guidelines

### **Branch Strategy**

```
main                  → Production-ready code
├── development-v3.5  → Next release (stable)
└── dxf-development-v3.5  → DXF feature experiments
```

### **Commit Convention**

```
feat: Add manual asset drawing feature
fix: Resolve DXF bbox estimation error
docs: Update API documentation
refactor: Simplify MDO enrichment logic
perf: Optimize legend matching cache
test: Add unit tests for NMS algorithm
chore: Update dependencies
```

### **Pull Request Template**

```markdown
## Description

Brief description of changes

## Type of Change

- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing

- [ ] Manual testing completed
- [ ] Unit tests added/updated
- [ ] Integration tests passed

## Screenshots (if applicable)

## Checklist

- [ ] Code follows project style
- [ ] Self-review completed
- [ ] Comments added for complex logic
- [ ] Documentation updated
- [ ] No new warnings
```

---

## 📞 Support & Contact

**Original Developers:**

- **Raden Rizky** (Backend, AI, DXF Parser)
- **Ihsan Alfarisi** (Frontend, UX, Optimization)

**Institution:**

- Politeknik Negeri Semarang
- Program Studi Teknik Komputer dan Informatika
- Praktik Industri 2026

**Project Repository:**

- GitHub: https://github.com/RadenRizky26/Asset-Detection

**Documentation:**

- User Guide: `/guide` (in-app)
- Technical Docs: `/docs` folder
- API Docs: (TODO: Swagger implementation)

---

## 📄 License

**Proprietary License**

This software is developed as part of an industrial internship program. All rights reserved by the original developers and affiliated institution. Unauthorized copying, modification, or distribution is prohibited without explicit written permission.

For licensing inquiries, contact the development team.

---

## 🙏 Acknowledgments

**Technologies Used:**

- Next.js 16 & React 19 Team
- Google Gemini AI Team
- Anthropic Claude Team
- OpenAI Team
- PostgreSQL Community
- Redis & BullMQ Maintainers
- PDF.js Mozilla Team
- ExcelJS Contributors

**Special Thanks:**

- PT [Client Name] untuk project opportunity
- Politeknik Negeri Semarang faculty
- Industrial supervisors
- Beta testers dari Maintenance & Reliability Division

---

## 📈 Roadmap (Future Development)

### **v4.0**

- [ ] Real-time WebSocket progress updates
- [ ] Batch processing (multiple documents)
- [ ] Advanced search & filtering
- [ ] Custom export templates
- [ ] API rate limiting per-user
- [ ] CSRF protection

### **v4.5**

- [ ] Mobile app (React Native)
- [ ] Offline mode dengan sync
- [ ] OCR fallback untuk embedded text
- [ ] Large file streaming upload
- [ ] Database backup automation
- [ ] Audit trail untuk compliance

### **v5.0**

- [ ] Machine learning model fine-tuning
- [ ] Custom symbol training
- [ ] RBI integration (Risk-Based Inspection)
- [ ] SAP/Maximo connector
- [ ] Multi-language support
- [ ] White-label option

---

**Last Updated:** November 4, 2026  
**Document Version:** 1.0  
**Maintained By:** Development Team

---

_"From manual tagging to AI-powered detection — TagFlow revolutionizes P&ID asset management."_
