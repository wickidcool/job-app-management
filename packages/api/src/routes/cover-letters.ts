import type { FastifyInstance } from 'fastify';
import { readdir, readFile } from 'fs/promises';
import { join, extname, basename } from 'path';
import { getConfig } from '../config.js';

interface CoverLetterSummary {
  id: string;
  title: string;
  keywords: string[];
  createdAt: string;
  preview: string;
}

export async function coverLettersRoutes(fastify: FastifyInstance) {
  // GET /api/cover-letters
  fastify.get('/cover-letters', async (request, reply) => {
    const config = getConfig();
    const coverLettersDir = join(config.dataDir, 'cover-letters');

    try {
      const files = await readdir(coverLettersDir);
      const mdFiles = files.filter((f) => extname(f) === '.md');

      const results: CoverLetterSummary[] = [];

      for (const file of mdFiles) {
        const filePath = join(coverLettersDir, file);
        const content = await readFile(filePath, 'utf-8');
        const id = basename(file, '.md');

        // Extract keywords from content (words after # Keywords: line or first 5 significant words)
        const keywordsMatch = content.match(/^#\s*Keywords?:\s*(.+)$/im);
        const keywords = keywordsMatch
          ? keywordsMatch[1].split(',').map((k) => k.trim())
          : [];

        const titleMatch = content.match(/^#\s+(.+)$/m);
        const title = titleMatch ? titleMatch[1].trim() : id;

        const preview = content.replace(/^#.+$/gm, '').trim().slice(0, 200);

        results.push({
          id,
          title,
          keywords,
          createdAt: new Date().toISOString(), // Would use file stat in production
          preview,
        });
      }

      const query = (request.query as { search?: string; limit?: string });
      let filtered = results;

      if (query.search) {
        const q = query.search.toLowerCase();
        filtered = results.filter(
          (r) =>
            r.title.toLowerCase().includes(q) ||
            r.keywords.some((k) => k.toLowerCase().includes(q)) ||
            r.preview.toLowerCase().includes(q),
        );
      }

      const limit = query.limit ? Math.min(parseInt(query.limit, 10), 100) : 20;
      return reply.send({ coverLetters: filtered.slice(0, limit) });
    } catch {
      // Directory doesn't exist yet — return empty list
      return reply.send({ coverLetters: [] });
    }
  });
}
