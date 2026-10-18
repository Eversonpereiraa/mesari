/** Valor por pessoa na conferência; null quando não há divisão (N ≤ 1). */
export function splitShare(total: number, splitCount: number | undefined) {
  const people = Math.floor(splitCount ?? 1);
  if (!Number.isFinite(people) || people <= 1) return null;
  return { people, each: Math.round((total * 100) / people) / 100 };
}
