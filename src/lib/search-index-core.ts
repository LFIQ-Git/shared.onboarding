import { docNav } from '@/lib/docs';
import { slugify } from '@/lib/slugify';

export interface SearchSection {
  heading: string;
  anchor: string;
  text: string;
}

export interface SearchDoc {
  href: string;
  title: string;
  group: string;
  sections: SearchSection[];
}

export { slugify };

function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/^\s*\|.*\|\s*$/gm, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_>#]/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function splitIntoSections(markdown: string): SearchSection[] {
  const lines = markdown.split('\n');
  const sections: SearchSection[] = [];
  let heading = '';
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const text = toPlainText(buffer.join('\n'));
    if (text.length > 0) {
      sections.push({ heading, anchor: heading ? slugify(heading) : '', text });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;

    const match = !inFence ? /^(#{2,3})\s+(.*)$/.exec(line) : null;
    if (match) {
      flush();
      heading = match[2].replace(/`/g, '').trim();
      continue;
    }

    if (!inFence && /^#\s+/.test(line)) continue;
    buffer.push(line);
  }

  flush();
  return sections;
}

export async function buildSearchIndexFromLoader(
  loadSource: (relativePath: string) => Promise<string | undefined>
): Promise<SearchDoc[]> {
  const docs: SearchDoc[] = [];

  for (const section of docNav) {
    for (const item of section.items) {
      const relative = item.href.replace(/^\/docs\/?/, '');
      if (!relative) continue;

      const source = await loadSource(relative);
      if (!source) continue;

      docs.push({
        href: item.href,
        title: item.label,
        group: section.title,
        sections: splitIntoSections(source),
      });
    }
  }

  return docs;
}
