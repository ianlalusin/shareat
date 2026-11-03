/**
 * Pinned public keys for local-profile grants (audit F02 / NOV-PROFILE).
 *
 * The server signs each grant with the ES256 private key in the App Hosting
 * secret SERVER_PROFILE_GRANT_PRIVATE_KEY. Devices verify the signature with
 * the public keys below, so an offline tablet can tell a real grant from an
 * edited localStorage entry without reaching the server.
 *
 * Shared by client and server: no Node or browser-only imports here.
 *
 * Rotation: generate a new P-256 keypair, ADD its public JWK here with a new
 * kid, ship an APK carrying it, then switch the secret to the new private key.
 * The server picks the kid whose public key matches the configured private key.
 * Remove an old entry only after every device runs an APK without needing it
 * (grants live at most PROFILE_GRANT_MAX_TTL_MS, so old grants die quickly).
 */

export const PROFILE_GRANT_ALG = "ES256" as const;
export const PROFILE_GRANT_TYP = "SPG" as const;
export const PROFILE_GRANT_ISSUER = "shareat-pos:server-profile-grant";
/** Hard ceiling on a grant's lifetime (exp - iat), checked on both sides. */
export const PROFILE_GRANT_MAX_TTL_MS = 16 * 60 * 60 * 1000;

export interface GrantPublicKey {
  kid: string;
  kty: "EC";
  crv: "P-256";
  x: string;
  y: string;
}

export const PINNED_PROFILE_GRANT_KEYS: readonly GrantPublicKey[] = [
  {
    kid: "spg-20261103",
    kty: "EC",
    crv: "P-256",
    x: "XfsGOKDJ3oamctM4zL4RgaG4f4ijGz8BoBN6wMXOv8g",
    y: "-0hAXo7FofGMSz99VVvXEf4h4y07pBayiGO8PsBZYJQ",
  },
];
