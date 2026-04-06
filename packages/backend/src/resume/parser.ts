import pdfParse from 'pdf-parse';

export interface ResumeEntry {
  company: string;
  title: string;
  dates: string;
  bullets: string[];
}

export interface ResumeSection {
  heading: string;
  entries: ResumeEntry[];
}

export interface ParsedResume {
  sections: ResumeSection[];
  rawText: string;
  warnings: string[];
}

const SECTION_NAMES = ['experience', 'education', 'skills', 'projects', 'certifications', 'summary', 'objective', 'work history', 'employment'];

export function isHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return false;
  // ALL CAPS heading
  if (trimmed === trimmed.toUpperCase() && trimmed.length > 2 && /^[A-Z\s]+$/.test(trimmed)) return true;
  // Markdown heading
  if (trimmed.startsWith('## ') || trimmed.startsWith('# ')) return true;
  // Known section name (case-insensitive)
  if (SECTION_NAMES.some(s => trimmed.toLowerCase() === s)) return true;
  return false;
}

function cleanHeading(line: string): string {
  return line.trim().replace(/^#+\s*/, '').trim();
}

function parseSections(text: string): ResumeSection[] {
  const lines = text.split('\n');
  const sections: ResumeSection[] = [];
  let currentSection: ResumeSection | null = null;
  let currentEntry: ResumeEntry | null = null;

  const flushEntry = () => {
    if (currentEntry && currentSection) {
      currentSection.entries.push(currentEntry);
      currentEntry = null;
    }
  };

  const flushSection = () => {
    flushEntry();
    if (currentSection) sections.push(currentSection);
    currentSection = null;
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      continue;
    }

    if (isHeading(line)) {
      flushSection();
      currentSection = { heading: cleanHeading(line), entries: [] };
      continue;
    }

    if (!currentSection) continue;

    // Bullet point
    if (/^[-•*]\s+/.test(line)) {
      if (!currentEntry) {
        currentEntry = { company: '', title: '', dates: '', bullets: [] };
      }
      currentEntry.bullets.push(line.replace(/^[-•*]\s+/, ''));
      continue;
    }

    // Date range pattern
    const dateMatch = line.match(/\b(\d{4})\s*[-–]\s*(\d{4}|present|current)\b/i);
    if (dateMatch && currentEntry) {
      currentEntry.dates = line;
      continue;
    }

    // Company/title lines: flush previous entry and start a new one
    if (currentEntry && currentEntry.company) {
      if (!currentEntry.title) {
        currentEntry.title = line;
      } else {
        // New entry begins
        flushEntry();
        currentEntry = { company: line, title: '', dates: '', bullets: [] };
      }
    } else {
      flushEntry();
      currentEntry = { company: line, title: '', dates: '', bullets: [] };
    }
  }

  flushSection();
  return sections;
}

export async function parseResume(buffer: Buffer, mimetype: string): Promise<ParsedResume> {
  if (buffer.length === 0) {
    return { sections: [], rawText: '', warnings: ['Empty file provided'] };
  }

  let rawText: string;

  try {
    if (mimetype === 'application/pdf' || mimetype === 'application/octet-stream') {
      const data = await pdfParse(buffer);
      rawText = data.text;
    } else {
      rawText = buffer.toString('utf8');
    }
  } catch (err) {
    return { sections: [], rawText: buffer.toString('utf8'), warnings: [`Failed to extract text: ${String(err)}`] };
  }

  let sections: ResumeSection[];
  const warnings: string[] = [];

  try {
    sections = parseSections(rawText);
    if (sections.length === 0) {
      warnings.push('Could not detect sections in resume — check formatting');
    }
  } catch {
    sections = [];
    warnings.push('Could not parse sections');
  }

  return { sections, rawText, warnings };
}
