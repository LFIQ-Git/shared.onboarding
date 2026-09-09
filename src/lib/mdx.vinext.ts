import { compileDocSource, type GetDocResult } from '@/lib/mdx-core';

const contentModules = import.meta.glob<string>('../content/**/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
});

export async function getDocBySlug(slug: string[]): Promise<GetDocResult> {
  const source = contentModules[`../content/${slug.join('/')}.md`];

  if (!source) {
    throw new Error(`Failed to load document: ${slug.join('/')}`);
  }

  return compileDocSource(source);
}

export async function getAllDocSlugs(): Promise<string[][]> {
  return Object.keys(contentModules)
    .map((filePath) =>
      filePath
        .replace('../content/', '')
        .replace(/\.md$/, '')
        .split('/')
    )
    .sort((left, right) => left.join('/').localeCompare(right.join('/')));
}
