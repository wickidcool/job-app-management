import { describe, it, expect } from 'vitest';
import {
  parseResumeText,
  generateStarMarkdown,
  extractExperienceEntries,
  generateProjectMarkdown,
  toProjectSlug,
} from '../src/services/resume.service.js';

describe('parseResumeText', () => {
  it('splits text into sections by heading keywords', () => {
    const text = `John Doe
Software Engineer

Experience
Acme Corp - Senior Dev 2022-2024
- Built microservices
- Led team of 5

Education
MIT - BS Computer Science 2018

Skills
TypeScript, Node.js, PostgreSQL`;

    const result = parseResumeText(text);
    expect(result.sections.length).toBeGreaterThanOrEqual(3);

    const expSection = result.sections.find((s) => /experience/i.test(s.heading));
    expect(expSection).toBeDefined();
    expect(expSection!.bullets.length).toBeGreaterThan(0);

    const eduSection = result.sections.find((s) => /education/i.test(s.heading));
    expect(eduSection).toBeDefined();
  });

  it('handles text with no recognized section headings', () => {
    const text = `Just some random text\nWithout any sections\nHere`;
    const result = parseResumeText(text);
    expect(result.sections.length).toBeGreaterThanOrEqual(1);
    expect(result.rawText).toBe(text);
  });

  it('filters empty lines', () => {
    const text = `Experience\n\n\nSome job\n\n- Did stuff\n`;
    const result = parseResumeText(text);
    const section = result.sections.find((s) => /experience/i.test(s.heading));
    expect(section).toBeDefined();
    expect(section!.bullets.every((b) => b.length > 0)).toBe(true);
  });
});

describe('generateStarMarkdown', () => {
  it('includes STAR headers for experience sections', () => {
    const parsed = {
      rawText: '',
      sections: [
        {
          heading: 'Work Experience',
          bullets: [
            'Acme Corp - Senior Engineer 2022-2024',
            '- Built microservices architecture',
            '- Reduced latency by 40%',
          ],
        },
      ],
    };

    const markdown = generateStarMarkdown(parsed, 'resume.pdf');
    expect(markdown).toContain('**Situation:**');
    expect(markdown).toContain('**Task:**');
    expect(markdown).toContain('**Action:**');
    expect(markdown).toContain('**Result:**');
    expect(markdown).toContain('Built microservices architecture');
    expect(markdown).toContain('Reduced latency by 40%');
  });

  it('outputs plain bullets for non-experience sections', () => {
    const parsed = {
      rawText: '',
      sections: [
        {
          heading: 'Skills',
          bullets: ['TypeScript', 'Node.js'],
        },
      ],
    };

    const markdown = generateStarMarkdown(parsed, 'resume.pdf');
    expect(markdown).toContain('## Skills');
    expect(markdown).not.toContain('**Situation:**');
    expect(markdown).toContain('- TypeScript');
  });

  it('includes file name in heading', () => {
    const parsed = { rawText: '', sections: [] };
    const markdown = generateStarMarkdown(parsed, 'my-resume.pdf');
    expect(markdown).toContain('my-resume.pdf');
  });
});

describe('extractExperienceEntries', () => {
  it('parses entries with pipe-delimited company, role, and period', () => {
    const parsed = parseResumeText(
      `Experience\nAcme Corp | Senior Engineer | 2021-2023\n- Built APIs\n- Led migrations`,
    );
    const entries = extractExperienceEntries(parsed);
    expect(entries).toHaveLength(1);
    expect(entries[0].company).toBe('Acme Corp');
    expect(entries[0].role).toBe('Senior Engineer');
    expect(entries[0].period).toBe('2021-2023');
    expect(entries[0].bullets).toEqual(['Built APIs', 'Led migrations']);
  });

  it('handles entry with no delimiter — company name only', () => {
    const parsed = parseResumeText(`Experience\nAcme Corp\n- Did something`);
    const entries = extractExperienceEntries(parsed);
    expect(entries).toHaveLength(1);
    expect(entries[0].company).toBe('Acme Corp');
    expect(entries[0].role).toBe('');
    expect(entries[0].period).toBe('');
  });

  it('handles entry with 0 bullets', () => {
    const parsed = parseResumeText(`Experience\nAcme Corp | Dev | 2020`);
    const entries = extractExperienceEntries(parsed);
    expect(entries).toHaveLength(1);
    expect(entries[0].bullets).toHaveLength(0);
  });

  it('returns empty array when no experience section exists', () => {
    const parsed = parseResumeText(`Skills\nTypeScript\nNode.js`);
    const entries = extractExperienceEntries(parsed);
    expect(entries).toHaveLength(0);
  });

  it('parses multiple entries within one section', () => {
    const parsed = parseResumeText(
      `Experience\nAcme Corp | Dev | 2022\n- Shipped features\nBeta Inc | Lead | 2020\n- Managed team`,
    );
    const entries = extractExperienceEntries(parsed);
    expect(entries).toHaveLength(2);
    expect(entries[0].company).toBe('Acme Corp');
    expect(entries[1].company).toBe('Beta Inc');
  });
});

describe('generateProjectMarkdown', () => {
  it('renders frontmatter with company, role, period, industry, tech, and job_fit', () => {
    const entry = { company: 'Acme Corp', role: 'Senior Engineer', period: '2021-2023', bullets: [] };
    const md = generateProjectMarkdown(entry);
    expect(md).toContain('company: Acme Corp');
    expect(md).toContain('role: Senior Engineer');
    expect(md).toContain('period: 2021-2023');
    expect(md).toContain('industry: _[Industry / sector]_');
    expect(md).toContain('tech: []');
    expect(md).toContain('job_fit: []');
    expect(md).toContain('tags: [star, resume, interview, prep]');
  });

  it('omits role and period fields from frontmatter when empty', () => {
    const entry = { company: 'Acme Corp', role: '', period: '', bullets: [] };
    const md = generateProjectMarkdown(entry);
    expect(md).toContain('company: Acme Corp');
    expect(md).not.toContain('role:');
    expect(md).not.toContain('period:');
  });

  it('includes header line with Role, Period, and Industry', () => {
    const entry = { company: 'Acme Corp', role: 'Dev', period: '2022', bullets: [] };
    const md = generateProjectMarkdown(entry);
    expect(md).toContain('**Role:** Dev | **Period:** 2022 | **Industry:** _[Industry / sector]_');
  });

  it('includes per-bullet STAR sections without numbered prefix or Index', () => {
    const entry = { company: 'Acme Corp', role: 'Dev', period: '2022', bullets: ['Built APIs', 'Led migrations'] };
    const md = generateProjectMarkdown(entry);
    expect(md).not.toContain('## Index');
    expect(md).toContain('## ⭐ Built APIs');
    expect(md).toContain('## ⭐ Led migrations');
    expect(md).toContain('**Tech:** _[List relevant technologies]_');
    expect(md).toContain('| **Action** | Built APIs |');
    expect(md).toContain('| **Action** | Led migrations |');
  });

  it('uses placeholder Action text when no bullets', () => {
    const entry = { company: 'Acme Corp', role: 'Dev', period: '2022', bullets: [] };
    const md = generateProjectMarkdown(entry);
    expect(md).toContain('_[Describe the specific steps you took]_');
    expect(md).not.toContain('## Index');
  });
});

describe('toProjectSlug', () => {
  it('lowercases and replaces non-alphanumeric with hyphens', () => {
    expect(toProjectSlug('Acme Corp')).toBe('acme-corp');
    expect(toProjectSlug('Foo & Bar, Inc.')).toBe('foo-bar-inc');
  });

  it('strips leading and trailing hyphens', () => {
    expect(toProjectSlug('  Acme  ')).toBe('acme');
  });

  it('sanitizes path traversal sequences — returns safe slug', () => {
    expect(toProjectSlug('../../evil')).toBe('evil');
    expect(toProjectSlug('../etc/passwd')).toBe('etc-passwd');
  });

  it('returns empty string for all-special-character company names', () => {
    expect(toProjectSlug('...')).toBe('');
    expect(toProjectSlug('---')).toBe('');
  });
});
