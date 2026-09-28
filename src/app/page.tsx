import Link from 'next/link';
import { BookOpen, Zap, Settings } from 'lucide-react';

export default function Home() {
  return (
    <div className="min-h-full bg-white dark:bg-gray-950 transition-colors">
      {/* Hero section */}
      <section className="py-20 bg-gradient-to-br from-blue-50 to-blue-100 dark:from-gray-900 dark:to-gray-800">
        <div className="container max-w-4xl text-center">
          <h1 className="text-5xl font-bold text-gray-900 dark:text-gray-50 mb-4">
            LFIQ Tech Stack Onboarding
          </h1>
          <p className="text-xl text-gray-700 dark:text-gray-300 mb-8">
            Everything you need to know to get started with our tools and infrastructure
          </p>
          <Link
            href="/docs"
            className="inline-block px-8 py-3 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 transition-colors"
          >
            Explore Docs
          </Link>
        </div>
      </section>

      {/* Quick link cards */}
      <section className="py-16 bg-white dark:bg-gray-950">
        <div className="container max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {/* Getting Started */}
            <Link
              href="/docs/getting-started/install"
              className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg hover:border-blue-300 dark:hover:border-blue-700 transition-all bg-white dark:bg-gray-900"
            >
              <div className="flex items-center gap-3 mb-4">
                <Settings className="text-blue-600 dark:text-blue-400" size={24} />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                  Getting Started
                </h3>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Install tools and set up your development environment
              </p>
            </Link>

            {/* Architecture */}
            <Link
              href="/docs/architecture"
              className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg hover:border-green-300 dark:hover:border-green-700 transition-all bg-white dark:bg-gray-900"
            >
              <div className="flex items-center gap-3 mb-4">
                <Zap className="text-green-600 dark:text-green-400" size={24} />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                  Architecture
                </h3>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Learn how the LFIQ platform is designed and structured
              </p>
            </Link>

            {/* Cheat Sheet */}
            <Link
              href="/docs/cheat-sheet"
              className="p-6 border border-gray-200 dark:border-gray-800 rounded-lg hover:shadow-lg hover:border-purple-300 dark:hover:border-purple-700 transition-all bg-white dark:bg-gray-900"
            >
              <div className="flex items-center gap-3 mb-4">
                <BookOpen className="text-purple-600 dark:text-purple-400" size={24} />
                <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-50">
                  Cheat Sheet
                </h3>
              </div>
              <p className="text-gray-600 dark:text-gray-400 text-sm">
                Quick reference for commands, APIs, and common tasks
              </p>
            </Link>
          </div>
        </div>
      </section>

      {/* Main content grid */}
      <section className="py-16 bg-white dark:bg-gray-950">
        <div className="container max-w-4xl">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
            {/* Apps section */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
                Applications
              </h2>
              <ul className="space-y-3">
                {[
                  { label: 'Hub', href: '/docs/apps/hub' },
                  { label: 'Intel', href: '/docs/apps/intel' },
                  { label: 'Command', href: '/docs/apps/command' },
                  { label: 'Keystone', href: '/docs/apps/keystone' },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Guides section */}
            <div>
              <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-6">
                Guides
              </h2>
              <ul className="space-y-3">
                {[
                  { label: 'Troubleshooting', href: '/docs/common-errors' },
                  { label: 'Common Tasks', href: '/docs/property-onboarding' },
                  { label: 'Daily Operations', href: '/docs/daily-briefing' },
                  { label: 'Deployment', href: '/docs/cloudflare-deployment' },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* Video section */}
      <section className="py-16 bg-gray-100 dark:bg-gray-900">
        <div className="container max-w-4xl">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-8 text-center">
            Video Guides
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {[
              { title: 'Setup', duration: '10 min' },
              { title: 'Hub Login', duration: '5 min' },
              { title: 'Intel Example', duration: '8 min' },
            ].map((video) => (
              <div
                key={video.title}
                className="bg-white dark:bg-gray-800 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
              >
                <div className="bg-gray-300 dark:bg-gray-700 h-48 flex items-center justify-center">
                  <div className="text-gray-500 dark:text-gray-400 text-center">
                    <p className="font-semibold">{video.title}</p>
                    <p className="text-sm mt-2">{video.duration}</p>
                  </div>
                </div>
                <div className="p-4">
                  <h3 className="font-semibold text-gray-900 dark:text-gray-50">
                    {video.title}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mt-2">
                    {video.duration}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA section */}
      <section className="py-16 bg-white dark:bg-gray-950">
        <div className="container max-w-2xl">
          <div className="border-l-4 border-blue-600 pl-8 py-8 bg-blue-50 dark:bg-gray-900 px-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-50 mb-4">
              Ready to dive in?
            </h2>
            <p className="text-gray-700 dark:text-gray-300 mb-6">
              Start with the Getting Started guide to set up your development environment
              and learn the basics of the LFIQ tech stack.
            </p>
            <Link
              href="/docs/getting-started/install"
              className="inline-block px-6 py-3 bg-blue-600 text-white font-medium rounded hover:bg-blue-700 transition-colors"
            >
              Begin Now
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
