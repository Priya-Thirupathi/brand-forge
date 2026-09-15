import { createHash } from "node:crypto";

// TRD.md §10: the raw client IP is never stored, only sha256(IP_HASH_SALT + ip).
export function hashIp(ip: string, salt: string): string {
  return createHash("sha256").update(salt + ip).digest("hex");
}
