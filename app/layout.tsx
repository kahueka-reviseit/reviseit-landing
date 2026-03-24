import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Revise It — Assessment Intelligence for South African Schools',
  description:
    'Give your department the evidence, tools, and insights to lead where teachers thrive, students excel, and parents become true learning partners.',
  openGraph: {
    title: 'Revise It — Assessment Intelligence for South African Schools',
    description:
      'Stop managing in the dark. Start leading with evidence.',
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
