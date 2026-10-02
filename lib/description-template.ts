export function compareDescription(
  proposed: string | null,
  size: string | null,
  fromRef: string | null,
  toRef: string | null,
  type: string
): { fallback: string; matches: boolean } {
  // Expected format: "{Location}-{TypeCode} {Size}" FROM {From} TO {To}
  // Simplified for this implementation without parsing Location/TypeCode from Type

  // Format the base fallback
  let fallback = "";

  // If we have size but need the {Location}-{TypeCode} prefix
  if (size) {
    fallback = `${type} ${size}`;
  } else {
    fallback = type;
  }

  if (fromRef && toRef) {
    fallback += ` FROM ${fromRef} TO ${toRef}`;
  } else if (toRef) {
    fallback += ` TO ${toRef}`;
  }

  // Exact fallback behavior required by instructions
  // Fallback template: "{Location}-{TypeCode} {Size}" FROM {From} TO {To}". If From is missing, use without FROM.
  const parts = [];

  // Try to match the specific template requested
  // We'll treat `type` as the `{Location}-{TypeCode}` part if it's provided as such
  parts.push(size ? `${type} ${size}` : type);

  if (fromRef && toRef) {
    parts.push(`FROM ${fromRef} TO ${toRef}`);
  } else if (toRef) {
    parts.push(`TO ${toRef}`);
  }

  const generatedFallback = parts.join(" ");

  const matches = proposed !== null &&
                 proposed.toLowerCase().trim() === generatedFallback.toLowerCase().trim();

  return {
    fallback: generatedFallback,
    matches
  };
}
