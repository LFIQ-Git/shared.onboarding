# Marketing Site Guide

leftfieldiq.com is the public-facing product marketing website for LFIQ. It describes the platform, team, investment thesis, and career opportunities.

## What It Does

The marketing site is LFIQ's storefront for investors, LPs, partners, and prospective employees:
- **Product overview:** What LFIQ does, how it's different
- **Investment thesis:** Why we're investing in real estate / PropTech
- **Team profiles:** Investment team, engineering team, advisors
- **Case studies:** Example deals and portfolio performance
- **Press & news:** Recent announcements, media mentions
- **Careers:** Job listings, company culture, hiring
- **Contact:** General inquiries, partnership requests

**Primary features:**
- Hero landing page
- Platform features section (Hub, Intel, Command, Keystone, Registry, Stacks, Sticks)
- Team bios with photos
- Blog (optional, not currently implemented)
- Contact form
- Newsletter signup (optional)

## Deployment

| Environment | URL | Status | Platform |
|-------------|-----|--------|----------|
| **Production** | https://leftfieldiq.com | Live | Vercel |
| **Preview** | Vercel preview URL per branch | Auto-deploy on PR | Vercel |
| **Local Dev** | http://localhost:3007 | Via `npm run dev` | Local machine |

The site is `leftfieldiq.com`. `leftfieldiq.app` does not resolve; do not link to it.

## Tech Stack

| Component | Tech | Notes |
|-----------|------|-------|
| **Framework** | Next.js 15 | React 19, static generation (SSG) |
| **Language** | TypeScript | Full type coverage |
| **Styling** | Tailwind CSS | Utility-first CSS |
| **Content** | MDX | Markdown with embedded React components |
| **Hosting** | Vercel | Global CDN, automatic deploys |
| **Auth** | None | Public website, no login required |

## Local Development

### Start the Site

```bash
cd /path/to/brick.apps/apps/leftfieldiq-site
npm run dev
# Runs on http://localhost:3007
```

### File Structure

```
apps/leftfieldiq-site/
├── app/
│   ├── page.tsx              # Home page (hero + features)
│   ├── about/page.tsx        # Team, mission, values
│   ├── careers/page.tsx      # Job listings
│   ├── contact/page.tsx      # Contact form
│   └── layout.tsx            # Global layout, header, footer
├── components/
│   ├── Header.tsx            # Navigation bar
│   ├── Footer.tsx            # Footer with links
│   ├── FeatureCard.tsx       # Reusable card component
│   └── ...
├── content/
│   ├── team.json             # Team member data
│   ├── jobs.json             # Job listings
│   └── ...
├── public/
│   ├── images/
│   │   ├── logo.png
│   │   ├── team/
│   │   └── ...
│   └── ...
└── ...
```

### Environment Variables

| Variable | Required? | Purpose |
|----------|-----------|---------|
| `NEXT_PUBLIC_SITE_URL` | No | Site URL for og:url tags (defaults to leftfieldiq.com) |
| `SENDGRID_API_KEY` | No | Email for contact form (optional) |

Pull from Vercel:
```bash
vercel env pull
```

## Key Pages

### Page 1: Home (/)

The hero landing page with:
- **Headline:** "Real estate investment powered by AI"
- **Subheadline:** Description of LFIQ platform
- **Features:** Visual cards for Hub, Intel, Command, Keystone, Registry, Stacks, Sticks
- **CTA buttons:** "Explore Platform" (link to Hub), "Contact Us" (link to /contact)
- **Social proof:** Logos of investors, partners, or metrics

### Page 2: About (/about)

Team and company information:
- **Mission statement**
- **Team bios:** Name, title, photo, brief bio for each team member
- **Values:** Investment philosophy, operating principles
- **Advisors:** If applicable, list of external advisors

### Page 3: Careers (/careers)

Job listings and hiring information:
- **Job board:** Available positions (Software Engineer, Data Analyst, Product Manager, etc.)
- **Culture:** Why work at LFIQ
- **Benefits:** Compensation, equity, health insurance, etc.
- **How to apply:** Link to job application form (usually external)

### Page 4: Contact (/contact)

Contact form and inquiry information:
- **Contact form:** Name, email, message, inquiry type (business, careers, press)
- **Email:** General contact email (team@lfiq.app)
- **Social links:** LinkedIn, GitHub, etc. (if applicable)

## Common Tasks

### Task 1: Update Team Member Bio

Edit `apps/leftfieldiq-site/content/team.json`:

```json
[
  {
    "name": "Jane Doe",
    "title": "Founder & Principal",
    "bio": "Jane has 10 years of experience in real estate operations and PropTech.",
    "photo": "/images/team/jane.jpg",
    "email": "jane@leftfieldinv.com",
    "linkedin": "https://linkedin.com/in/janedoe"
  },
  // Add new team member here
]
```

Then add photo to `public/images/team/`.

Restart: `npm run dev`

### Task 2: Add a Job Listing

Edit `apps/leftfieldiq-site/content/jobs.json`:

```json
[
  {
    "title": "Senior Software Engineer",
    "department": "Engineering",
    "location": "San Francisco, CA",
    "type": "Full-time",
    "description": "We're hiring a senior engineer to build the next generation of real estate software...",
    "applyUrl": "https://jobs.example.com/apply/senior-engineer",
    "postedDate": "2024-08-11"
  },
  // Add new job here
]
```

Restart: `npm run dev`

### Task 3: Update Hero Copy

Edit `apps/leftfieldiq-site/app/page.tsx`:

```typescript
export default function Home() {
  return (
    <section className="hero">
      <h1>Real estate investment powered by AI</h1>
      <p>Your new headline here</p>
      {/* ... */}
    </section>
  );
}
```

Restart: `npm run dev`

### Task 4: Add a Blog Post (Future)

When blog is implemented:

```bash
# Create new markdown file
touch apps/leftfieldiq-site/content/blog/my-post.mdx

# Add frontmatter
---
title: "Post Title"
date: "2024-08-11"
author: "Author Name"
---

# Post content in markdown
```

## Troubleshooting

### Issue 1: "Team photos not loading"
**Symptom:** Team page shows broken image icons  
**Cause:** Image file not in /public/images/team/, or wrong path in JSON  
**Fix:**
```bash
# Verify image exists
ls apps/leftfieldiq-site/public/images/team/

# Update JSON with correct path (relative to /public)
# Should be: "/images/team/jane.jpg" not "./images/team/jane.jpg"

npm run dev
```

### Issue 2: "Job board not showing new postings"
**Symptom:** Added job to jobs.json but it doesn't appear on /careers  
**Cause:** Next.js cache not cleared, or JSON syntax error  
**Fix:**
```bash
# Clear Next.js cache
rm -rf .next

# Verify JSON is valid
cat apps/leftfieldiq-site/content/jobs.json | json_pp
# If error, fix syntax (missing comma, bracket, etc.)

npm run dev
```

### Issue 3: "Vercel deployment fails"
**Symptom:** Push to main doesn't deploy  
**Cause:** Build error, missing environment variable, or image optimization issue  
**Fix:**
```bash
# Test build locally
npm run build

# If build fails, check error message
# Common issues: missing image, TypeScript error, missing dependency

# Check Vercel build logs
vercel logs --follow

# Deploy manually if needed
vercel deploy --prod
```

## Content Guidelines

### Tone & Voice
- **Professional but approachable**: Not stuffy, not overly casual
- **Real estate operator voice**: Speak like investors, not marketers
- **No jargon**: Explain concepts clearly
- **Specific over vague, but only with a figure you can source**: never invent a count. If you do not have the number, cut the sentence

### Images
- **Team photos:** Professional headshots (500x500px minimum, JPEG or PNG)
- **Feature icons:** Consistent style, 200x200px minimum
- **Product screenshots:** Clean, recent (no outdated UI)
- **Brand colors:** Use LFIQ brand guidelines (if published)

### Links
- **Internal links:** Use relative paths (/about, /careers)
- **External links:** Use full URLs (https://example.com)
- **No dead links**: Verify all URLs are current

## SEO & Meta Tags

The site automatically generates meta tags for:
- `<title>`: Page title (defaults to "LFIQ | Real Estate Powered by AI")
- `og:title`, `og:description`, `og:image`: Social media sharing
- `meta charset`, `viewport`: Mobile-friendly, encoding

To customize, edit `app/layout.tsx`:

```typescript
export const metadata: Metadata = {
  title: "LFIQ | Real Estate Powered by AI",
  description: "...",
  openGraph: {
    title: "LFIQ",
    description: "...",
    images: ["/images/og-image.png"],
  },
};
```

## Related Documentation

- **Getting Started:** Setup, Logins, Install Tools
- **Vercel Deployment:** Auto-deploy on git push to main
- **Next.js:** Static generation (SSG), image optimization, SEO
