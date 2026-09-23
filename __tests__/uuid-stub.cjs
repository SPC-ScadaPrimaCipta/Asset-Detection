// Jest CJS stub for uuid v14 (pure ESM, unparseable by Jest CJS mode).
// Pure-function accuracy tests never call uuidv4 at runtime — import-only.
let counter = 0;
function v4() {
  counter += 1;
  return `test-uuid-${String(counter).padStart(4, '0')}-0000-4000-8000-000000000000`;
}
module.exports = { v4, default: { v4 } };
