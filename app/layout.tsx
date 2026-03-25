import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Revise It — Test Creation for Grade 11 Physical Sciences',
  description:
    'A complete 4-document assessment package for every question. CAPS-aligned, original, and ready to print. Free pilot for 20 teachers.',
  openGraph: {
    title: 'Revise It — Test Creation for Grade 11 Physical Sciences',
    description:
      'You know what a great assessment looks like. You just don\'t have time to build one. Join the free pilot.',
    url: 'https://reviseit.io',
    siteName: 'Revise It',
    locale: 'en_ZA',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
