export const generateUuidV7 = (): string => {
  const timestampHex = Date.now().toString(16).padStart(12, '0').slice(-12);
  const randomHex = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    .toString(16)
    .padStart(20, '0')
    .slice(-20);
  return `${timestampHex.slice(0, 8)}-${timestampHex.slice(8, 12)}-7${randomHex.slice(0, 3)}-8${randomHex.slice(3, 6)}-${randomHex.slice(6, 18)}`;
};
