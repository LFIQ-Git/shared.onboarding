import fs from 'fs/promises';
import path from 'path';
import { compileDocSource, type GetDocResult } from '@/lib/mdx-core';

export async function getDocBySlug(slug: string[]): Promise<GetDocResult> {
  const contentPath = path.join(process.cwd(), 'src', 'content');
  const filePath = path.join(contentPath, ...slug) + '.md';

  try {
    const source = await fs.readFile(filePath, 'utf-8');

    return compileDocSource(source);
  } catch {
    throw new Error(`Failed to load document: ${slug.join('/')}`);
  }
}

export async function getAllDocSlugs(): Promise<string[][]> {
  const contentPath = path.join(process.cwd(), 'src', 'content');
  const slugs: string[][] = [];

  async function walkDir(dir: string, prefix: string[] = []): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const slugPart = entry.name.replace(/\.md$/, '');

      if (entry.isDirectory()) {
        await walkDir(fullPath, [...prefix, entry.name]);
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        slugs.push([...prefix, slugPart]);
      }
    }
  }

  await walkDir(contentPath);
  return slugs;
}
