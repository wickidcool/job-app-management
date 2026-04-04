export const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'to', 'of', 'for', 'in', 'on', 'at', 'by', 'with', 'from', 'into',
  'over', 'and', 'or', 'but', 'not', 'it', 'its', 'as', 'if', 'we',
  'our', 'us', 'you', 'your', 'they', 'their', 'this', 'that', 'these',
  'those', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'can', 'could', 'should', 'may', 'might', 'shall', 'must', 'also',
  'more', 'such', 'each', 'all', 'any', 'both', 'other',
]);

export function tokenize(text: string): Set<string> {
  const tokens = text
    .split(/[\s,;()\[\]{}<>'"!?\/\\|@#$%^&*+=~`]+/)
    .map(t => t.toLowerCase().replace(/[^a-z0-9.+#-]/g, ''))
    .filter(t => t.length >= 2 && !STOP_WORDS.has(t));
  return new Set(tokens);
}

interface ProjectSection {
  slug: string;
  keywords: Set<string>;
}

function parseIndexSections(indexContent: string): ProjectSection[] {
  const sections: ProjectSection[] = [];
  const parts = indexContent.split(/^## /m).slice(1);
  for (const part of parts) {
    const lines = part.split('\n');
    const heading = lines[0].trim();
    const slug = heading.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const keywords = new Set<string>();
    for (const line of lines.slice(1)) {
      const techMatch = line.match(/\*\*Tech:\*\*\s*(.+)/);
      const kwMatch = line.match(/\*\*Keywords:\*\*\s*(.+)/);
      const terms = techMatch?.[1] ?? kwMatch?.[1];
      if (terms) {
        for (const term of terms.split(',').map(t => t.trim().toLowerCase())) {
          if (term) keywords.add(term);
        }
      }
    }
    sections.push({ slug, keywords });
  }
  return sections;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter(t => b.has(t)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

export interface MatchResult {
  score: number;
  matchedKeywords: string[];
  missedKeywords: string[];
  projectScores: Array<{ slug: string; name: string; score: number; matchedKeywords: string[] }>;
}

export function matchJobDescription(jobDescription: string, indexContent: string): MatchResult {
  const jobTokens = tokenize(jobDescription);
  const sections = parseIndexSections(indexContent);

  const allIndexKeywords = new Set(sections.flatMap(s => [...s.keywords]));
  const matchedKeywords = [...jobTokens].filter(t => allIndexKeywords.has(t));
  const missedKeywords = [...jobTokens].filter(t => !allIndexKeywords.has(t));

  const projectScores = sections.map(s => {
    const score = jaccard(jobTokens, s.keywords);
    const matched = [...jobTokens].filter(t => s.keywords.has(t));
    return {
      slug: s.slug,
      name: s.slug.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
      score,
      matchedKeywords: matched,
    };
  }).sort((a, b) => b.score - a.score);

  const totalWeight = projectScores.length;
  const overallScore = totalWeight === 0 ? 0 : projectScores.reduce((sum, p) => sum + p.score, 0) / totalWeight;

  return { score: overallScore, matchedKeywords, missedKeywords, projectScores };
}
