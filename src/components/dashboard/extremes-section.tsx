'use client';

import { useState } from 'react';
import type { PriceExtreme } from '@/lib/types';
import { formatKrw, formatPct } from '@/lib/format';
import { SectionCard, EmptyHint } from '@/components/ui-bits';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

export function ExtremesSection({ extremes }: { extremes: PriceExtreme[] }) {
  const [tab, setTab] = useState('new-high');
  const highs = extremes.filter((e) => e.type === 'new-high');
  const lows = extremes.filter((e) => e.type === 'new-low');

  if (extremes.length === 0) {
    return (
      <SectionCard
        title="신고가 · 신저가"
        description="보유·목표·관심 지역의 최근 2개월 거래 중 직전 최고가/최저가를 갱신한 건입니다."
      >
        <EmptyHint>
          최근 2개월 내 신고가·신저가 갱신 거래가 없거나, 아직 원본 실거래가 수집되지 않았습니다.
        </EmptyHint>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="신고가 · 신저가"
      description="단지 + 5㎡ 면적 버킷 단위로 과거 전체 이력과 비교합니다. 해제(취소) 거래는 제외했습니다."
      badge={
        <Badge variant="secondary">
          신고가 {highs.length} · 신저가 {lows.length}
        </Badge>
      }
    >
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="new-high">신고가 {highs.length}</TabsTrigger>
          <TabsTrigger value="new-low">신저가 {lows.length}</TabsTrigger>
        </TabsList>

        {(['new-high', 'new-low'] as const).map((type) => {
          const rows = type === 'new-high' ? highs : lows;
          return (
            <TabsContent key={type} value={type} className="mt-3">
              {rows.length === 0 ? (
                <EmptyHint>해당 유형의 거래가 없습니다.</EmptyHint>
              ) : (
                <div className="thin-scrollbar max-h-96 overflow-auto rounded-md border">
                  <Table>
                    <TableHeader className="bg-background sticky top-0">
                      <TableRow>
                        <TableHead>단지</TableHead>
                        <TableHead className="text-right">전용</TableHead>
                        <TableHead className="text-right">층</TableHead>
                        <TableHead className="text-right">거래가</TableHead>
                        <TableHead className="text-right">직전 대비</TableHead>
                        <TableHead className="text-right">거래일</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((e, i) => (
                        <TableRow key={`${e.complexName}-${e.dealDate}-${i}`}>
                          <TableCell>
                            <div className="font-medium">{e.complexName}</div>
                            <div className="text-muted-foreground text-[11px]">
                              {e.sigungu} {e.dong}
                            </div>
                          </TableCell>
                          <TableCell className="tabular text-right">
                            {e.areaM2.toFixed(0)}㎡
                          </TableCell>
                          <TableCell className="tabular text-right">{e.floor}층</TableCell>
                          <TableCell className="tabular text-right font-semibold">
                            {formatKrw(e.price, { compact: true })}
                          </TableCell>
                          <TableCell
                            className={cn(
                              'tabular text-right font-medium',
                              type === 'new-high' ? 'text-rise' : 'text-fall',
                            )}
                          >
                            {formatKrw(e.gap, { compact: true })}
                            <span className="ml-1 text-[11px]">({formatPct(e.gapRate, 1)})</span>
                          </TableCell>
                          <TableCell className="tabular text-muted-foreground text-right">
                            {e.dealDate.slice(5)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </SectionCard>
  );
}
