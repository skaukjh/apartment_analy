import type { Metadata } from 'next';
import { IBM_Plex_Sans_KR, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { ThemeProvider } from '@/components/theme-provider';
import { SiteHeader } from '@/components/site-header';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';

const sans = IBM_Plex_Sans_KR({
  variable: '--font-sans',
  subsets: ['latin'],
  weight: ['300', '400', '500', '600', '700'],
});

const mono = JetBrains_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
});

export const metadata: Metadata = {
  title: '부동산인사이트',
  description:
    '보유 아파트와 목표 아파트의 시세 갭, 세금·거래비용, 상승장 확산, 호재 진행, 과열 지표를 한 화면에서 확인하고 카카오톡으로 일일 브리핑을 받습니다.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="ko"
      suppressHydrationWarning
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="bg-background flex min-h-full flex-col">
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider delay={150}>
            <SiteHeader />
            <main className="flex-1">{children}</main>
          </TooltipProvider>
          <footer className="text-muted-foreground border-t py-6 text-center text-xs">
            세금·비용은 참고용 추정치입니다. 실제 신고 전 홈택스·위택스 또는 세무 전문가로
            확인하세요.
          </footer>
          <Toaster position="top-center" richColors />
        </ThemeProvider>
      </body>
    </html>
  );
}
