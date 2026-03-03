/**
 * Replaces `{key}` placeholders in endpoint paths.
 */
export function interpolatePath(path: string, pathParams?: Record<string, string>): string {
  if (!pathParams) return path;

  let nextPath = path;
  for (const [key, value] of Object.entries(pathParams)) {
    nextPath = nextPath.replaceAll(`{${key}}`, encodeURIComponent(value));
  }

  return nextPath;
}
