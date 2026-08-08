export async function hashPasscode(storeId: string, passcode: string): Promise<string> {
  const input = `${storeId}:${passcode}`;
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
