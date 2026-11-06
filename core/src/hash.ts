/** SHA-256 of the exact source as UTF-8, hex. Runs in Node and in an extension service worker. */
export async function hashCode(src: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(src));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
