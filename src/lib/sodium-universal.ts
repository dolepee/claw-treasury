export function sodium_memzero(buffer: Uint8Array | undefined | null): void {
  if (!buffer) {
    return;
  }

  buffer.fill(0);
}
