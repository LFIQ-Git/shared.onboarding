import React from 'react';
import { compileMDX } from 'next-mdx-remote/rsc';
import remarkGfm from 'remark-gfm';
import { Callout } from '@/components/content/Callout';
import { CodeBlock } from '@/components/content/CodeBlock';
import { Table } from '@/components/content/Table';
import { VideoEmbed } from '@/components/content/VideoEmbed';
import { mdxComponents } from '@/lib/mdx-components';

export interface DocMetadata {
  title?: string;
  description?: string;
}

export interface GetDocResult {
  content: React.ReactElement;
  metadata?: DocMetadata;
}

const componentsMap = {
  ...mdxComponents,
  CodeBlock,
  VideoEmbed,
  Callout,
  Table,
};

export async function compileDocSource(source: string): Promise<GetDocResult> {
  const { content, frontmatter } = await compileMDX({
    source,
    components: componentsMap,
    options: {
      parseFrontmatter: true,
      mdxOptions: {
        remarkPlugins: [remarkGfm],
      },
    },
  });

  return {
    content,
    metadata: frontmatter as DocMetadata,
  };
}
