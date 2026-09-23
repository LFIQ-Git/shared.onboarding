export function Footer() {
  // The Pacific calendar day. The Worker renders in UTC, which is already
  // tomorrow from 5 PM (PDT) / 4 PM (PST) onward.
  const today = new Date().toLocaleDateString('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 transition-colors">
      <div className="container py-8 text-center">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          LFIQ Onboarding Manual. Updated {today}. Questions? Ask in #engineering
          on Slack.
        </p>
      </div>
    </footer>
  );
}
