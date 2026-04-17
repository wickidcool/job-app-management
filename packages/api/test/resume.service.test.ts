import { describe, it, expect } from 'vitest';
import { parseResumeText, generateStarMarkdown } from '../src/services/resume.service.js';

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
