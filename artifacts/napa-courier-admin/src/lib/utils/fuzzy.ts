export function levenshteinDistance(a: string, b: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

export function similarityScore(a: string, b: string): number {
  const distance = levenshteinDistance(a.toLowerCase(), b.toLowerCase());
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 100 : ((maxLength - distance) / maxLength) * 100;
}

export function findSimilarLocation(
  siteName: string,
  address: string,
  existingLocations: Array<{ siteName: string; address: string; city: string; state: string }>,
  threshold = 80
): { siteName: string; city: string; state: string } | null {
  for (const loc of existingLocations) {
    const nameScore = similarityScore(siteName, loc.siteName);
    const addressScore = similarityScore(address, loc.address);

    if (nameScore > threshold && addressScore > threshold) {
      return { siteName: loc.siteName, city: loc.city, state: loc.state };
    }
  }
  return null;
}
