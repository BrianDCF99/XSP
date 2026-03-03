/**
 * Applies static query key/value pairs to a URL object.
 */
export function addQueryParams(url: URL, query?: Record<string, string>): void {
  if (!query) return;

  for (const [key, value] of Object.entries(query)) {
    url.searchParams.set(key, value);
  }
}
