-- Risk Mapping module — PFD (Process Flow Diagram) upload/tagging schema.
-- Idempotent: safe to re-run.
--
-- Consolidates what was originally delivered as 5 incremental scripts
-- (schema, default_page, generic-attribute-source columns, and two
-- attribute-classification corrections) into the single final shape, since
-- we're seeding a fresh DB rather than replaying someone else's migration
-- history. Final classification: Risk Color and Risk Matrix Name are
-- mandatory (hardcoded, not rows in this table — see MANDATORY_ATTRS in
-- app/api/risk-mapping/asset-tag-info/route.ts); Risk Level, Risk Rank,
-- Next Inspection Year, Damage Mechanism(s), and Risk Model are the
-- configurable set below.

IF OBJECT_ID('dbo.rbi_pfd_document', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.rbi_pfd_document (
        pfd_id              INT IDENTITY(1,1) PRIMARY KEY,
        public_id           UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID(),
        pfd_name            NVARCHAR(200)   NOT NULL,
        description         NVARCHAR(1000)  NULL,
        asset_id            INT             NOT NULL,
        current_version_id  INT             NULL,
        is_deleted          BIT             NOT NULL DEFAULT 0,
        created_by          VARCHAR(50)     NOT NULL,
        created_at          DATETIME        NOT NULL DEFAULT GETDATE(),
        updated_by          VARCHAR(50)     NULL,
        updated_at          DATETIME        NULL
        -- asset_id logically references dbo.rbi_asset(asset_id); no physical FK because
        -- rbi_asset has no PK/unique index, matching this app's existing convention of
        -- app-level (not DB-level) referential integrity for that table.
    );
END
GO

-- Ensure public_id exists if table was already created prior to this column being added
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.rbi_pfd_document')
      AND name = 'public_id'
)
BEGIN
    ALTER TABLE dbo.rbi_pfd_document
        ADD public_id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID();
    EXEC('UPDATE dbo.rbi_pfd_document SET public_id = NEWID() WHERE public_id IS NULL');
END
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'UQ_pfd_document_public_id'
      AND object_id = OBJECT_ID('dbo.rbi_pfd_document')
)
BEGIN
    CREATE UNIQUE INDEX UQ_pfd_document_public_id
        ON dbo.rbi_pfd_document(public_id);
END
GO

IF OBJECT_ID('dbo.rbi_pfd_version', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.rbi_pfd_version (
        version_id      INT IDENTITY(1,1) PRIMARY KEY,
        pfd_id          INT             NOT NULL,
        version_no      INT             NOT NULL,
        file_name       NVARCHAR(260)   NOT NULL,
        file_path       NVARCHAR(500)   NOT NULL,
        file_size       BIGINT          NOT NULL,
        page_count      INT             NOT NULL,
        default_page    INT             NOT NULL DEFAULT 1,
        uploaded_by     VARCHAR(50)     NOT NULL,
        uploaded_at     DATETIME        NOT NULL DEFAULT GETDATE(),
        notes           NVARCHAR(500)   NULL,
        CONSTRAINT FK_pfd_version_document FOREIGN KEY (pfd_id) REFERENCES dbo.rbi_pfd_document(pfd_id),
        CONSTRAINT UQ_pfd_version_no UNIQUE (pfd_id, version_no)
    );
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_pfd_document_current_version')
BEGIN
    ALTER TABLE dbo.rbi_pfd_document
        ADD CONSTRAINT FK_pfd_document_current_version FOREIGN KEY (current_version_id) REFERENCES dbo.rbi_pfd_version(version_id);
END
GO

IF OBJECT_ID('dbo.rbi_pfd_asset_map', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.rbi_pfd_asset_map (
        map_id          INT IDENTITY(1,1) PRIMARY KEY,
        version_id      INT             NOT NULL,
        asset_id        INT             NOT NULL,
        page_no         INT             NOT NULL,
        rect_x          FLOAT           NOT NULL,
        rect_y          FLOAT           NOT NULL,
        rect_width      FLOAT           NOT NULL,
        rect_height     FLOAT           NOT NULL,
        matched_text    NVARCHAR(200)   NULL,
        detection_mode  VARCHAR(10)     NOT NULL DEFAULT 'MANUAL',
        created_by      VARCHAR(50)     NOT NULL,
        created_at      DATETIME        NOT NULL DEFAULT GETDATE(),
        updated_by      VARCHAR(50)     NULL,
        updated_at      DATETIME        NULL,
        CONSTRAINT FK_pfd_map_version FOREIGN KEY (version_id) REFERENCES dbo.rbi_pfd_version(version_id),
        -- asset_id logically references dbo.rbi_asset(asset_id); no physical FK, see rbi_pfd_document above.
        CONSTRAINT CK_pfd_map_detection_mode CHECK (detection_mode IN ('AUTO', 'MANUAL'))
        -- No uniqueness constraint on (version_id, asset_id) - the same asset
        -- can legitimately be tagged in more than one spot on one drawing.
    );
END
GO

-- Tag attribute display config: which configurable attributes show in a
-- tag's info panel, in what order. Risk Color and Risk Matrix Name are NOT
-- rows here - they're mandatory and always shown, computed in code. Every
-- row below is also code-computed today (none use the generic
-- source_table/source_column engine yet), but the columns exist so a new
-- attribute can be added later via a plain INSERT with no code change, for
-- any simple lookup keyed by an asset-id column and an rbim-id column.
IF OBJECT_ID('dbo.rbi_pfd_tag_attribute_def', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.rbi_pfd_tag_attribute_def (
        attr_key            VARCHAR(30)     NOT NULL PRIMARY KEY,
        label               NVARCHAR(100)   NOT NULL,
        order_no            INT             NOT NULL,
        is_enabled          BIT             NOT NULL DEFAULT 1,
        source_table        NVARCHAR(128)   NULL,
        source_column       NVARCHAR(128)   NULL,
        asset_id_column     NVARCHAR(128)   NULL,
        rbim_id_column      NVARCHAR(128)   NULL,
        is_multi_row        BIT             NOT NULL DEFAULT 0
    );

    INSERT INTO dbo.rbi_pfd_tag_attribute_def (attr_key, label, order_no, is_enabled) VALUES
        ('NEXT_INSPECTION_YEAR', 'Year of Next Inspection', 1, 1),
        ('DAMAGE_MECHANISM',     'Damage Mechanism(s)',     2, 1),
        ('RISK_LEVEL',           'Risk Level',              3, 1),
        ('RISK_RANK',            'Risk Rank',               4, 1),
        ('RISK_MODEL',           'Risk Model',              5, 1);
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pfd_document_asset')
    CREATE INDEX IX_pfd_document_asset ON dbo.rbi_pfd_document(asset_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pfd_version_pfd')
    CREATE INDEX IX_pfd_version_pfd ON dbo.rbi_pfd_version(pfd_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pfd_asset_map_version')
    CREATE INDEX IX_pfd_asset_map_version ON dbo.rbi_pfd_asset_map(version_id);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_pfd_asset_map_asset')
    CREATE INDEX IX_pfd_asset_map_asset ON dbo.rbi_pfd_asset_map(asset_id);
GO

IF OBJECT_ID('dbo.rbi_pfd_label_layout', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.rbi_pfd_label_layout (
        layout_id    UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        map_id       INT              NOT NULL,
        rbim_id      INT              NOT NULL,
        layout_x     FLOAT            NOT NULL,
        layout_y     FLOAT            NOT NULL,
        box_width    FLOAT            NULL,    -- custom label card width in px (base 135 px); NULL = default
        label_scale  FLOAT            NULL,    -- custom label size percentage (e.g. 75, 60, 90); NULL = default
        saved_by     VARCHAR(50)      NOT NULL,
        saved_at     DATETIME         NOT NULL DEFAULT GETDATE(),
        CONSTRAINT FK_label_layout_map FOREIGN KEY (map_id) REFERENCES dbo.rbi_pfd_asset_map(map_id) ON DELETE CASCADE,
        CONSTRAINT UQ_label_layout_map_model UNIQUE (map_id, rbim_id)
    );
END
GO

-- Ensure box_width exists if table was already created prior to this column being added
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.rbi_pfd_label_layout')
      AND name = 'box_width'
)
BEGIN
    ALTER TABLE dbo.rbi_pfd_label_layout
        ADD box_width FLOAT NULL;
END
GO

-- Ensure label_scale exists if table was already created prior to this column being added
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.rbi_pfd_label_layout')
      AND name = 'label_scale'
)
BEGIN
    ALTER TABLE dbo.rbi_pfd_label_layout
        ADD label_scale FLOAT NULL;
END
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_label_layout_map')
    CREATE INDEX IX_label_layout_map ON dbo.rbi_pfd_label_layout(map_id);
GO
