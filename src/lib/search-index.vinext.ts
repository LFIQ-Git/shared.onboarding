import {
  buildSearchIndexFromLoader,
  type SearchDoc,
  type SearchSection,
} from '@/lib/search-index-core';

const contentModules = import.meta.glob<string>('../content/**/*.md', {
  eager: true,
  import: 'default',
  query: '?raw',
});

export type { SearchDoc, SearchSection };
export { slugify } from '@/lib/search-index-core';

export function buildSearchIndex(): Promise<SearchDoc[]> {
  return buildSearchIndexFromLoader(async (relativePath) => {
    return contentModules[`../content/${relativePath}.md`];
  });
}
