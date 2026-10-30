import {
  applyProjectAutoTagging,
  loadProjectExistingTags,
  allocateNextProjectTag,
  suggestAbbreviation,
} from '@/lib/tag-generator';

describe('Project-Level Automatic Tagging Pipeline Integration', () => {
  it('loads existing project tags from db mock and ignores other projects', async () => {
    const mockDb = {
      query: jest.fn().mockImplementation(async (sql: string, params: unknown[]) => {
        const projectId = params[0];
        if (projectId === 'proj-alpha') {
          return {
            rows: [
              { tag: 'GTV-001' },
              { tag: 'GTV-002' },
              { tag: 'P-001' },
            ],
          };
        }
        return { rows: [] };
      }),
    };

    const projectTags = await loadProjectExistingTags(mockDb, 'proj-alpha');
    expect(projectTags.has('GTV-001')).toBe(true);
    expect(projectTags.has('GTV-002')).toBe(true);
    expect(projectTags.has('P-001')).toBe(true);
    expect(projectTags.size).toBe(3);

    const emptyTags = await loadProjectExistingTags(mockDb, 'proj-beta');
    expect(emptyTags.size).toBe(0);
  });

  it('guarantees unique tags across multi-page detections in the same project', () => {
    // Project already has GTV-001 and GTV-002 from previous documents
    const existingProjectTags = new Set<string>(['GTV-001', 'GTV-002']);

    const legendSymbols = [
      { asset_type: 'Gate Valve', tag_pattern: 'GTV-###' },
      { asset_type: 'Ball Valve', tag_pattern: 'BV-###' },
    ];

    // Page 1 detections: 2 gate valves without tags
    const page1Detections = [
      { assetTag: null, assetType: 'Gate Valve', evidence: [] },
      { assetTag: null, assetType: 'Gate Valve', evidence: [] },
    ];

    const res1 = applyProjectAutoTagging(page1Detections, {
      existingProjectTags,
      legendSymbols,
    });

    expect(res1.generatedCount).toBe(2);
    expect(page1Detections[0].assetTag).toBe('GTV-003');
    expect(page1Detections[1].assetTag).toBe('GTV-004');
    expect(page1Detections[0].evidence).toContain('[Auto-Tag] Generated unique project tag GTV-003 (GTV)');

    // Page 2 detections in same project: 1 gate valve and 1 ball valve
    const page2Detections = [
      { assetTag: null, assetType: 'Gate Valve', evidence: [] },
      { assetTag: null, assetType: 'Ball Valve', evidence: [] },
    ];

    const res2 = applyProjectAutoTagging(page2Detections, {
      existingProjectTags,
      legendSymbols,
    });

    expect(res2.generatedCount).toBe(2);
    // Page 2 must continue from GTV-004 to GTV-005, never repeating GTV-001..GTV-004
    expect(page2Detections[0].assetTag).toBe('GTV-005');
    expect(page2Detections[1].assetTag).toBe('BV-001');

    // Total unique tags in project
    expect(existingProjectTags.has('GTV-005')).toBe(true);
    expect(existingProjectTags.has('BV-001')).toBe(true);
  });

  it('preserves detected OCR tags and avoids allocating collisions with them', () => {
    const existingProjectTags = new Set<string>();

    const detections = [
      // First item already has an OCR tag found on drawing
      { assetTag: 'P-001', assetType: 'Pump', evidence: ['OCR text detected: P-001'] },
      // Second item has no tag
      { assetTag: null, assetType: 'Pump', evidence: [] },
    ];

    const legendSymbols = [
      { asset_type: 'Pump', tag_pattern: 'P-###' },
    ];

    const res = applyProjectAutoTagging(detections, {
      existingProjectTags,
      legendSymbols,
    });

    expect(res.generatedCount).toBe(1);
    expect(detections[0].assetTag).toBe('P-001');
    expect(detections[1].assetTag).toBe('P-002');
  });
});
