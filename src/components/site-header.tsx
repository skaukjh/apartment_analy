'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Building2, LineChart, Moon, Settings, Sun, Sparkles } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// short 는 모바일용 축약 라벨.
// 메뉴 4개를 긴 이름 그대로 두면 390px 화면에서 뒤쪽 두 개가 밖으로 밀려나
// 가로 스크롤을 해야만 눌린다. 실제로 "메뉴가 안 눌린다"는 제보가 있었다.
const NAV = [
  { href: '/', label: '대시보드', short: '대시보드', icon: Building2 },
  { href: '/today', label: '오늘의 요약', short: '요약', icon: Sparkles },
  { href: '/simulation', label: '갈아타기 시뮬레이션', short: '시뮬레이션', icon: LineChart },
  { href: '/settings', label: '설정', short: '설정', icon: Settings },
];

export function SiteHeader() {
  const pathname = usePathname();
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <header className="bg-background/85 supports-[backdrop-filter]:bg-background/60 sticky top-0 z-40 border-b backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-2 px-4">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold">
          <Building2 className="size-5" />
          <span className="hidden sm:inline">부동산 갈아타기</span>
        </Link>

        <nav className="thin-scrollbar flex flex-1 items-center gap-1 overflow-x-auto">
          {NAV.map(({ href, label, short, icon: Icon }) => {
            const active = href === '/' ? pathname === '/' : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                prefetch
                aria-label={label}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors sm:px-3',
                  active
                    ? 'bg-secondary text-secondary-foreground font-medium'
                    : 'text-muted-foreground hover:bg-secondary/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4 shrink-0" />
                <span className="sm:hidden">{short}</span>
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </nav>

        <Button
          variant="ghost"
          size="icon"
          aria-label="테마 전환"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
        >
          <Sun className="size-4 dark:hidden" />
          <Moon className="hidden size-4 dark:block" />
        </Button>
      </div>
    </header>
  );
}
