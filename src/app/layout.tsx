import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import './globals.css';
import { Navigation } from '@/components/layout/Navigation';

const inter = Inter({ subsets: ['latin'] });

export const metadata: Metadata = {
  title: 'AutoShorts | Instagram to YouTube Shorts Automation',
  description: 'Production-ready multi-account Instagram Creator to YouTube Shorts automation dashboard powered by n8n, PostgreSQL and Google Drive.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark h-full">
      <body className={`${inter.className} h-full bg-zinc-950 text-zinc-100 antialiased flex flex-col md:flex-row overflow-hidden`}>
        {/* Navigation Sidebar & Mobile Header/Nav */}
        <Navigation />

        {/* Main Content Area */}
        <main className="flex-1 flex flex-col h-full overflow-y-auto pb-16 md:pb-0">
          {children}
        </main>
      </body>
    </html>
  );
}
