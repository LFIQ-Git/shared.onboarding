/**
 * Documentation navigation tree
 * Used by the Next.js web app to render sidebar navigation and breadcrumbs
 */

export interface DocItem {
  href: string;
  label: string;
}

export interface DocSection {
  title: string;
  items: DocItem[];
}

export const docNav: DocSection[] = [
  {
    title: 'Quick Start',
    items: [
      { href: '/docs/cheat-sheet', label: 'Cheat Sheet' },
      { href: '/docs/architecture', label: 'Architecture' },
      { href: '/docs/domains', label: 'Domains' },
    ],
  },
  {
    title: 'Getting Started',
    items: [
      { href: '/docs/getting-started/install', label: 'Install Tools' },
      { href: '/docs/getting-started/setup', label: 'Local Setup' },
      { href: '/docs/getting-started/logins', label: 'Logins & Auth' },
    ],
  },
  {
    title: 'Applications',
    items: [
      { href: '/docs/apps/hub', label: 'Hub' },
      { href: '/docs/apps/intel', label: 'Intel' },
      { href: '/docs/apps/command', label: 'Command' },
      { href: '/docs/apps/keystone', label: 'Keystone' },
      { href: '/docs/apps/registry', label: 'Registry' },
      { href: '/docs/apps/stacks', label: 'Stacks' },
      { href: '/docs/apps/sticks', label: 'Sticks' },
      { href: '/docs/apps/leftfieldiq-site', label: 'Marketing Site' },
    ],
  },
  {
    title: 'Infrastructure',
    items: [
      { href: '/docs/neon-database', label: 'Neon Database' },
      { href: '/docs/cloudflare-deployment', label: 'Cloudflare Deployment' },
      { href: '/docs/fly-io-backend', label: 'Fly.io Backend' },
      { href: '/docs/access-auth', label: 'Cloudflare Access' },
    ],
  },
  {
    title: 'Workflows',
    items: [
      { href: '/docs/data-ingestion', label: 'Data Ingestion' },
      { href: '/docs/property-onboarding', label: 'Property Onboarding' },
      { href: '/docs/deal-sourcing', label: 'Deal Sourcing' },
      { href: '/docs/daily-briefing', label: 'Daily Briefing Generation' },
    ],
  },
  {
    title: 'Troubleshooting',
    items: [
      { href: '/docs/common-errors', label: 'Common Errors' },
      { href: '/docs/neon-debugging', label: 'Neon Debugging' },
      { href: '/docs/cloudflare-debugging', label: 'Cloudflare Debugging' },
      { href: '/docs/auth-issues', label: 'Authentication Issues' },
    ],
  },
];

/**
 * Helper function to find a doc by href
 */
export function findDoc(href: string): DocItem | null {
  for (const section of docNav) {
    const item = section.items.find((item) => item.href === href);
    if (item) return item;
  }
  return null;
}

/**
 * Helper function to get breadcrumbs for a given href
 */
export function getBreadcrumbs(href: string): Array<{ label: string; href?: string }> {
  const breadcrumbs: Array<{ label: string; href?: string }> = [
    { label: 'Docs', href: '/docs' },
  ];

  const parts = href.split('/').filter(Boolean);

  for (let i = 1; i < parts.length; i++) {
    const currentPath = '/' + parts.slice(0, i + 1).join('/');
    const doc = findDoc(currentPath);

    if (doc) {
      if (i === parts.length - 1) {
        // Last item (current page)
        breadcrumbs.push({ label: doc.label });
      } else {
        // Intermediate item
        breadcrumbs.push({ label: doc.label, href: currentPath });
      }
    }
  }

  return breadcrumbs;
}

/**
 * Helper function to get the previous and next docs in navigation order
 */
export function getAdjacentDocs(href: string): { prev?: DocItem; next?: DocItem } {
  const allDocs = docNav.flatMap((section) => section.items);
  const currentIndex = allDocs.findIndex((doc) => doc.href === href);

  if (currentIndex === -1) return {};

  return {
    prev: currentIndex > 0 ? allDocs[currentIndex - 1] : undefined,
    next: currentIndex < allDocs.length - 1 ? allDocs[currentIndex + 1] : undefined,
  };
}
