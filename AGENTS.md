<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Automatic Asset Detection — Master Development Prompt

## 1. IMPORTANT SCOPE

Project: independent Automatic Asset Detection feature/application.

Existing reference repository:
```text
C:\Users\SrydenID\Documents\GitHub\promia-web-sb
```

**Risk Mapping inside that repo is ONLY for UI/UX and optional reusable functions.**

Do NOT:
* treat entire `promia-web-sb` as architectural reference
* assume Automatic Asset Detection must follow Promia architecture
* modify existing Promia functionality unnecessarily
* redesign or rewrite Risk Mapping
* make Automatic Asset Detection dependent on Risk Mapping without clear justification

## 2. HOW TO USE RISK MAPPING AS REFERENCE

Locate Risk Mapping feature inside `C:\Users\SrydenID\Documents\GitHub\promia-web-sb`.

Analyze ONLY Risk Mapping for:

### UI/UX
page layout, visual hierarchy, spacing, typography, cards, buttons, forms, tables, filters, search, pagination, tabs, modals/dialogs, detail panels, status badges, charts, heatmap, data visualization, loading states, empty states, error states, confirmation dialogs, edit flows, responsive behavior, interaction patterns

### Reusable functionality
Search, Filter, Sort, Pagination, Detail View, Status Management, Data Table, Data Visualization, Edit, Delete, Confirmation, Export.

**Do NOT copy functionality simply because it exists in Risk Mapping.**

Only reuse/adapt when it provides clear value for Automatic Asset Detection.

## 3. CORE PRINCIPLE

Relationship:
```text
Risk Mapping
     │
     ├── UI/UX Reference
     │
     └── Optional Functional Reference
              │
              ▼
     Automatic Asset Detection
```

NOT:
```text
Automatic Asset Detection
        │
        ├── Risk Mapping Backend
        ├── Risk Mapping Database
        ├── Risk Mapping API
        └── Entire Promia Architecture
```

Automatic Asset Detection must remain independently designed and maintainable.

## 4. PRODUCT OBJECTIVE

Enable user workflow:

```text
Legend
   ↓
P&ID / PFD Upload
   ↓
Automatic Asset Detection
   ├── Symbol Detection
   ├── Tag Detection
   ├── Legend Matching
   ├── Spatial Association
   └── Confidence Scoring
   ↓
Human Review
   ├── Confirm
   ├── Edit
   ├── Reject
   └── Manual Add
   ↓
Asset Register
   ↓
Excel Export
```

Future integration (NOT in MVP):
```text
Automatic Asset Detection → Asset Register → Risk Mapping → Risk Assessment → RBI/API 581
```

Do NOT implement RBI/API 581.

## 5. MVP TECHNOLOGY STACK

### Frontend
Next.js, React, TypeScript, Tailwind CSS, Responsive design

### Backend
Node.js, TypeScript, Fastify or equivalent

### Database
PostgreSQL (specifically designed for this app, not copied from Risk Mapping)

### AI
Google Gemini OR DeepSeek (multimodal/image understanding)
- API keys must remain server-side

### File Storage
S3, MinIO, or existing compatible storage
- Do NOT store large PDFs in PostgreSQL

### Background Processing
Redis + BullMQ or equivalent
- Detection must be asynchronous
- Do NOT keep HTTP request open during P&ID analysis

## 6. APPLICATION MODULES

```text
Automatic Asset Detection
├── Dashboard
├── Projects
├── Documents
├── Legend Library
├── Detection Jobs
├── P&ID Viewer
├── Detected Assets
├── Asset Review
└── Asset Register / Export
```

## 7. LEGEND LIBRARY

Legend is critical — different plants use different P&ID symbols.

AI uses selected Legend as primary reference.

Example Legend structure:
```json
{
  "name": "Pump",
  "assetType": "Pump",
  "description": "Pump symbol according to selected P&ID legend",
  "aliases": ["P", "PUMP"],
  "tagPatterns": ["P-###"]
}
```

**Tag patterns must be configurable per Legend.**
Do NOT hard-code all asset tag patterns globally.

## 8. LEGEND CREATION

Support workflow:
```text
Upload Legend PDF
       ↓
AI Legend Analysis
   ├── Symbol Detection
   ├── Symbol Name
   ├── Asset Type
   ├── Alias
   └── Description
       ↓
Human Review
       ↓
Save Legend
```

Also support manual Legend symbol creation/edit.

## 9. P&ID / PFD DOCUMENT UPLOAD

Users upload PDF.

Validate:
* file type, MIME type, file size
* corrupted files, empty documents

After upload:
```text
PDF
 ├── page count
 ├── page metadata
 └── rendered page images
```

Avoid blindly sending extremely large PDFs to Gemini/DeepSeek.

Prefer:
```text
PDF → Page Extraction → High Resolution Page Image → AI Analysis
```

## 10. DETECTION JOB

Async job representation.

Statuses:
```text
PENDING
PROCESSING
COMPLETED
FAILED
CANCELLED
```

UI shows job progress:
```text
Analyzing P&ID...
Page 3 of 12
Detected: 23 assets
High confidence: 17
Needs review: 6
```

## 11. AI AGENT ARCHITECTURE

```text
ai/
├── agent/
│   ├── asset-detection-agent.ts
│   ├── agent-runner.ts
│   ├── prompts.ts
│   └── schemas.ts
├── tools/
│   ├── legend-tool.ts
│   ├── document-tool.ts
│   ├── page-tool.ts
│   ├── image-tool.ts
│   ├── ocr-tool.ts
│   ├── detection-tool.ts
│   └── asset-tool.ts
└── providers/
    ├── gemini.ts
    └── deepseek.ts
```

Adjust per actual backend architecture.

## 12. AI AGENT RESPONSIBILITIES

1. Read selected Legend
2. Understand Legend symbols
3. Analyze P&ID pages
4. Identify equipment symbols
5. Identify asset tags
6. Associate tags with symbols
7. Match symbols against Legend
8. Determine asset type
9. Extract descriptions only when explicitly visible
10. Identify relevant nearby textual information
11. Determine bounding boxes
12. Assign confidence
13. Provide evidence
14. Return structured JSON
15. Never invent unavailable information

## 13. AI SYSTEM PROMPT TEMPLATE

```text
You are an industrial P&ID asset detection AI agent.

Your task: identify physical assets and equipment from P&ID/PFD documents.

Selected Legend is the primary source of truth for interpreting symbols.

For every detected asset, determine:
- Asset Type
- Asset Tag
- Description (when explicitly visible)
- Bounding Box
- Confidence
- Matching Legend Symbol
- Evidence

Rules:
1. Use selected Legend as primary symbol reference
2. Do not invent information
3. If value cannot be reliably determined, return null
4. Do not fabricate asset tags or descriptions
5. Distinguish between symbols and nearby text
6. Use spatial relationships when associating tags with symbols
7. Provide evidence for every detection
8. Return valid structured JSON only
9. Every detection must have confidence score
```

Improve based on testing.

## 14. STRUCTURED AI OUTPUT

Schema validated output.

Example:
```json
{
  "page": 1,
  "detections": [
    {
      "assetType": "Vessel",
      "assetTag": "V-101",
      "description": null,
      "confidence": 0.96,
      "bbox": {
        "x": 1200,
        "y": 800,
        "width": 500,
        "height": 700
      },
      "legendSymbol": "Vessel",
      "evidence": [
        "Symbol matches selected Legend",
        "Tag V-101 detected near symbol"
      ]
    }
  ]
}
```

Backend validates AI response before persisting.

Malformed AI output must never directly enter database.

## 15. ASSET DETECTION

System should support common industrial assets, but asset types driven by selected Legend.

Examples: Pump, Valve, Vessel, Tank, Compressor, Heat Exchanger, Filter, Instrument, PSV, Control Valve, Motor, Fan.

Do NOT assume these are the only types.

## 16. TAG DETECTION

System recognizes common tag formats: P-101, V-101, E-201, T-101, XV-103, FV-201, PSV-201.

**Tag recognition rules must be configurable through selected Legend.**

Do NOT hard-code universal rules.

## 17. SPATIAL ASSOCIATION

AI system associates asset tags with nearby equipment symbols.

Example:
```text
        V-101
          │
      ┌───────┐
      │ Vessel│
      └───────┘
```

Determine based on: spatial proximity, symbol structure, Legend, text position, context.

Do NOT associate unrelated nearby tags merely because close.

## 18. OCR

Use OCR when useful for: asset tags, equipment labels, descriptions, notes, P&ID identifiers.

OCR complements multimodal AI analysis, not replaces.

## 19. CONFIDENCE SCORE

Every detection has: `confidence: 0.0 - 1.0`

Suggested interpretation:
```text
>= 0.95 → High
0.80 - 0.94 → Medium
< 0.80 → Review Required
```

Make thresholds configurable.

## 20. EVIDENCE

Every detection contains evidence explaining why detected.

Example:
```text
Symbol matches selected Legend.
Asset tag V-101 is visible next to the symbol.
```

Evidence based on actual document content.

Never generate fabricated evidence.

## 21. HUMAN REVIEW

Automatic detection must NOT directly become final Asset Register without review.

Every detection supports:
```text
Confirm
Edit
Reject
Manual Add
```

## 22. DETECTION STATUS

Use:
```text
DETECTED
CONFIRMED
REJECTED
MANUAL
```

Review status:
```text
PENDING
REVIEWED
APPROVED
REJECTED
```

Rejected assets must not appear in final Asset Register.

## 23. P&ID VIEWER

Interactive P&ID viewer.

Supports: zoom, pan, page navigation, bounding boxes, asset labels, hover, click, highlight, selected asset synchronization, table-to-viewer synchronization.

Clicking asset in table highlights corresponding bounding box.
Clicking bounding box selects corresponding asset.

## 24. ASSET TABLE

Professional asset table.

Columns: No, Asset Tag, Asset Type, Description, P&ID, Page, Confidence, Status, Action

Supports: search, filtering, sorting, pagination, asset type filter, confidence filter, status filter, page filter.

Use Risk Mapping table UX as visual reference.

## 25. ASSET DETAIL

Display when user opens asset:

Asset Tag, Asset Type, Equipment Class, Description, P&ID, Page, Service, Location, Unit, Area, Legend, Legend Symbol, Confidence, Detection Status, Review Status, Evidence, Bounding Box.

Allow editing where appropriate.

## 26. MANUAL ASSET CREATION

Users can manually create asset when AI fails.

Flow:
```text
Add Asset
   ↓
Select/Draw Bounding Box
   ↓
Enter Asset Information
   ↓
Save
```

Manual assets marked: `detectionStatus = MANUAL`

## 27. DATABASE

Use PostgreSQL.

Design specifically for this application.

Suggested entities:
```text
Project
Document
DocumentPage
Legend
LegendSymbol
LegendSymbolAlias
DetectionJob
AgentRun
Detection
Asset
AssetReview
ExportJob
```

Do not create unnecessary entities.

## 28. ASSET MODEL

Suggested fields:
```text
id
projectId
documentId
documentPageId
assetTag
assetType
equipmentClass
description
service
location
unit
area
pidNumber
pidPage
legendId
legendSymbolId
confidence
detectionStatus
reviewStatus
bboxX
bboxY
bboxWidth
bboxHeight
evidence
createdAt
updatedAt
```

Adapt when necessary.

## 29. DATABASE DESIGN PRINCIPLE

Do NOT blindly copy database model from Risk Mapping.

Risk Mapping is only UI/UX reference.

Automatic Asset Detection database designed around:
```text
Documents
Legends
Detection Jobs
AI Runs
Detections
Assets
Reviews
Exports
```

If future Risk Mapping integration needed, design identifiers and relationships so integration can be added cleanly later.

## 30. AI AGENT RUN LOGGING

Store AI execution information:
```text
id
jobId
model
promptVersion
startedAt
completedAt
status
inputMetadata
outputMetadata
error
```

Important for debugging and improving detection quality.

## 31. API

Clean API.

Suggested endpoints:
```text
POST   /api/projects
GET    /api/projects
GET    /api/projects/:id

POST   /api/documents
GET    /api/documents/:id
DELETE /api/documents/:id

POST   /api/legends
GET    /api/legends
GET    /api/legends/:id
PUT    /api/legends/:id
DELETE /api/legends/:id

POST   /api/detection/jobs
GET    /api/detection/jobs/:id
POST   /api/detection/jobs/:id/cancel

GET    /api/assets
GET    /api/assets/:id
PUT    /api/assets/:id

POST   /api/assets/:id/confirm
POST   /api/assets/:id/reject
POST   /api/assets/manual

GET    /api/projects/:id/export/assets
```

Adapt naming per actual implementation.

## 32. FRONTEND PAGES

Suggested pages:
```text
/dashboard
/projects
/projects/[projectId]
/projects/[projectId]/documents
/projects/[projectId]/detection
/projects/[projectId]/assets
/legends
/legends/new
/legends/[legendId]
/projects/[projectId]/export
```

Adjust per chosen architecture.

## 33. MAIN DETECTION PAGE

Primary UI contains:
```text
┌─────────────────────────────────────────────────────┐
│ Automatic Asset Detection                           │
├─────────────────────────────────────────────────────┤
│ Document: [P&ID-001.pdf]                            │
│ Legend:   [Company P&ID Standard ▼]                │
│             [ Run Detection ]                       │
├───────────────────────┬─────────────────────────────┤
│                       │ Detected Assets            │
│                       │ ┌────────────────────────┐  │
│   P&ID Viewer         │ │ V-101 │ Vessel │ 96%  │  │
│   Bounding Boxes      │ │ P-101 │ Pump   │ 92%  │  │
│                       │ │ E-201 │ HX     │ 88%  │  │
│                       │ └────────────────────────┘  │
│                       │                             │
└───────────────────────┴─────────────────────────────┘
```

Design follows Risk Mapping visual language where appropriate.

## 34. DASHBOARD

Display useful detection metrics:
```text
Total Documents
Total Detection Jobs
Total Detected Assets
Confirmed Assets
Pending Review
Rejected Assets
Average Confidence
```

Optional charts:
```text
Assets by Type
Assets by Confidence
Detection Status
Documents Processed
```

Use visualization patterns inspired by Risk Mapping when appropriate.

## 35. LEGEND MANAGEMENT UI

Support:
```text
Legend List
Create Legend
Upload Legend
Edit Legend
Delete Legend
View Symbols
Edit Symbols
Add Symbol
```

Example table: Legend Name, Description, Symbols, Created, Updated, Actions.

## 36. DOCUMENT MANAGEMENT UI

Display:
```text
Document Name
Type
Pages
Upload Date
Status
Detection Status
Actions: View, Run Detection, Delete
```

## 37. UX PRINCIPLES

Application must feel: Professional, Industrial, Technical, Clean, Data-driven, Easy to understand.

Do NOT create flashy consumer-style interface.

Prioritize: clarity, information hierarchy, usability, consistency, low cognitive load, efficient review workflow.

Use Risk Mapping as primary visual reference.

## 38. RESPONSIVE DESIGN

Support: Desktop, Laptop, Tablet.

Main detection workspace prioritizes desktop (P&ID analysis requires large visual space).

Do NOT sacrifice P&ID viewer usability for aggressive mobile layouts.

## 39. EXCEL ASSET REGISTER

Main output: `Asset_Register.xlsx`

Use: ExcelJS or equivalent.

Workbook contains 5 sheets:

### Sheet 1: Asset Register
Columns: No, Asset Tag, Asset Type, Equipment Class, Description, P&ID Number, P&ID Page, Service, Location, Unit, Area, Legend, Confidence, Detection Status, Review Status

### Sheet 2: Equipment Summary

### Sheet 3: Detection Summary

### Sheet 4: Legend Used

### Sheet 5: Detection Evidence
Columns: Asset Tag, Asset Type, Confidence, Legend Symbol, Evidence, P&ID Number, Page

## 40. EXCEL FORMATTING

Excel must be professional.

Include: headers, freeze panes, filters, readable column widths, borders, percentage formatting, date formatting, Excel tables, summary information.

Rejected assets must NOT appear in primary Asset Register.

Review items only included when user explicitly selects: `Include Review Items`.

## 41. SECURITY

Implement:
* authentication where required
* authorization
* project-level access control
* file validation, MIME validation, file size limits
* safe filenames, secure storage
* server-side Gemini credentials
* server-side DeepSeek credentials
* environment variables
* appropriate rate limiting

Never expose: `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` to browser.

## 42. ERROR HANDLING

Handle gracefully:
```text
Invalid PDF, Corrupted PDF, Empty PDF, Unsupported file
Gemini timeout, Gemini rate limit, Gemini API error
DeepSeek timeout, DeepSeek rate limit, DeepSeek API error
Malformed AI JSON
Queue failure, Storage failure, Database failure
Excel generation failure
```

User-facing errors must be understandable.

Never expose internal: API keys, stack traces, database credentials, internal paths, provider secrets.

## 43. OBSERVABILITY

Log useful information for:
```text
Document Upload
Detection Job
AI Agent
Gemini Request
Gemini Response
DeepSeek Request
DeepSeek Response
Validation
Database Persistence
Export
```

Include: jobId, documentId, page, agentRunId, duration, status, error.

Do not log secrets.

## 44. AI COST AND PERFORMANCE

Design efficiently.

Do NOT unnecessarily send same image to Gemini/DeepSeek multiple times.

Use: page-level analysis, image resizing, cropping, caching, structured output, asynchronous processing, retry policies, configurable model, configurable token/output limits, model cost and latency comparison tracking.

System designed so AI model can change without rewriting entire application.

## 45. FUTURE EXTENSIBILITY

System should allow future features: Asset Register → Risk Mapping → Risk Assessment → RBI → API 581.

Possible future integrations: existing Risk Mapping, equipment criticality, inspection planning, RBI, maintenance management, asset management.

Do NOT implement these future features now unless required for MVP.

## 46. DO NOT USE CUSTOM COMPUTER VISION TRAINING

For MVP, do NOT train custom object detection model.

Use: Gemini Multimodal/Vision + DeepSeek + Legend + OCR + Spatial reasoning + Structured output.

Architecture allows custom CV model introduction in future if necessary.

## 47. NO MCP / RAG REQUIREMENT

Automatic Asset Detection does NOT require: MCP, RAG, Hermes, Agentic Data Reconciliation.

Do not introduce unless explicitly required later.

AI Agent specifically focused on: P&ID/PFD + Legend + Asset Detection.

## 48. DEVELOPMENT PROCESS

Before writing code, perform focused inspection.

**Step 1:** Locate Risk Mapping inside `C:\Users\SrydenID\Documents\GitHub\promia-web-sb`.

Identify: relevant pages, components, styles, tables, forms, charts, heatmap, UI patterns, useful functions.

Do not analyze entire repository unless necessary.

## 49. FIRST RESPONSE REQUIREMENT

Before modifying code, provide concise but concrete analysis:

### A. Risk Mapping UI/UX Analysis
Risk Mapping location, Pages, Main layout, Tables, Forms, Charts, Heatmap, Dialogs, Reusable UI patterns, Responsive behavior

### B. Functions Worth Reusing
List only functions genuinely useful for Automatic Asset Detection.
Example: Search, Filtering, Status management, Table interaction, Detail panel, Export.
Explain why each relevant.

### C. Automatic Asset Detection Architecture
Frontend, Backend, AI Agent, PostgreSQL, Storage, Queue, Gemini, DeepSeek

### D. Database Design
Show proposed entities and relationships.

### E. API Design
Show proposed endpoints.

### F. UI Pages
Show proposed pages.

### G. Implementation Plan
Break into logical phases.

Do NOT start making large code changes until this analysis presented.

## 50. IMPLEMENTATION PHASES

### Phase 1: Project Foundation and Infrastructure
* frontend foundation
* backend foundation
* PostgreSQL configuration and schema design
* Redis + BullMQ setup
* storage abstraction for uploaded PDFs and generated files
* environment configuration and validation
* authentication/authorization design if required
* API documentation and service boundaries

### Phase 2: Legend Library
* Legend CRUD
* Legend symbol management
* tag-pattern configuration per Legend
* Legend upload flow
* Legend review workflow
* manual symbol creation/edit

### Phase 3: Document Management
* PDF upload
* PDF validation
* page extraction
* page metadata capture
* page rendering / preview preparation
* storage lifecycle management

### Phase 4: AI Agent and Model Integration
* Gemini integration
* DeepSeek integration
* unified model abstraction layer
* model-specific prompt adaptation
* configurable model selection
* structured output validation
* retry, timeout, and rate-limit handling
* cost and latency tracking

### Phase 5: Detection Pipeline and Job Execution
* symbol detection
* tag detection
* spatial association
* confidence scoring
* evidence generation
* job queue processing
* progress updates
* cancellation handling

### Phase 5.5: Testing & Observability
* unit tests for legend, document, and AI validation
* integration tests for detection and review workflows
* test fixtures for sample P&IDs and legends
* logging framework with jobId, documentId, agentRunId, durations
* error tracking and performance baselines

### Phase 6: Detection UI and P&ID Viewer
* detection job UI
* progress UI
* P&ID viewer
* bounding boxes
* asset table
* selection synchronization between viewer and table

### Phase 7: Human Review Workflow
* confirm
* edit
* reject
* manual add
* review status tracking
* bulk actions where useful

### Phase 8: Asset Register and Review Ledger
* final confirmed asset list
* filtering and search
* data validation before export
* review-state handling
* export-ready asset preparation

### Phase 9: Excel Export
* Asset Register workbook
* summary sheets
* evidence sheet
* legend information sheet
* formatting and professional export layout

### Phase 10: Production Hardening and Polish
* error handling
* loading states
* responsive UI
* performance tuning
* security hardening
* logging and observability
* API rate limiting
* backup strategy for database and uploaded files

## 51. IMPORTANT IMPLEMENTATION RULES

### Rule 1
Do not break existing Risk Mapping.

### Rule 2
Do not redesign existing Risk Mapping.

### Rule 3
Risk Mapping is only a UI/UX reference.

### Rule 4
Only reuse Risk Mapping functions when genuinely useful.

### Rule 5
Do not copy entire Promia architecture.

### Rule 6
Do not introduce unnecessary dependencies on Promia.

### Rule 7
Do not duplicate functionality without reason.

### Rule 8
Do not hard-code asset types if they can be derived from selected Legend.

### Rule 9
Do not hallucinate asset information.

### Rule 10
Every AI detection must have confidence and evidence.

### Rule 11
AI detections must be reviewed before becoming final Asset Register.

### Rule 12
Application must use PostgreSQL.

### Rule 13
Gemini and DeepSeek credentials must remain server-side.

### Rule 14
Detection must run asynchronously.

### Rule 15
Keep architecture modular.

## 52. QUALITY REQUIREMENTS

Final implementation should be:
```text
Production-oriented
Type-safe
Maintainable
Modular
Testable
Secure
Responsive
Observable
Extensible
```

Avoid:
```text
Huge monolithic files
Hard-coded business logic
Hard-coded asset types
Duplicated components
Duplicated database concepts
Unvalidated AI output
Client-side secrets
Synchronous long-running detection
```

## 53. TESTING

Implement tests for:

### Legend
* create, update, delete, symbol management

### Documents
* upload, validation, page extraction

### AI
* structured output
* schema validation
* malformed output
* missing values

### Detection
* asset detection
* tag association
* confidence
* evidence

### Review
* confirm, edit, reject, manual add

### Export
* Excel generation
* rejected asset exclusion
* review item inclusion

## 54. SUCCESS CRITERIA

Project successful when user can perform:

```text
1. Create project
2. Upload Legend
3. Review Legend
4. Upload P&ID PDF
5. Select Legend
6. Run Detection
7. AI analyzes P&ID
8. Assets detected
9. Bounding boxes displayed
10. Asset table populated
11. User reviews detections
12. User confirms/edits/rejects
13. Final Asset Register generated
14. Export Asset_Register.xlsx
```

Interface feels visually consistent with existing Risk Mapping feature while remaining independent Automatic Asset Detection feature.

## 55. FINAL DESIGN PRINCIPLE

Most important principle:

> **Build Automatic Asset Detection as independent, production-quality application/feature. Use existing Risk Mapping feature only as inspiration and reference for UI/UX, interaction patterns, visualization, and selected reusable functionality where it genuinely makes sense.**

Core product:

```text
LEGEND
   +
P&ID / PFD
   ↓
AI AGENT
   ↓
AUTOMATIC ASSET DETECTION
   ↓
HUMAN REVIEW
   ↓
ASSET REGISTER
   ↓
EXCEL EXPORT
```

Build system around this workflow.
