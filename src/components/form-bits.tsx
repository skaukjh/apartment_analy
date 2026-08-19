'use client';

import { useMemo, useRef, useState } from 'react';
import { Check, ChevronsUpDown, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { searchSigungu, type SigunguInfo } from '@/lib/regions';
import { formatKrw } from '@/lib/format';
import { cn } from '@/lib/utils';

/** 라벨 + 입력 한 줄 */
export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('space-y-1', className)}>
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
      {hint ? <p className="text-muted-foreground text-[11px]">{hint}</p> : null}
    </div>
  );
}

/**
 * 금액 입력 — 만원 단위로 입력받고 아래에 억/만 표기로 확인시켜 준다.
 * 한국에서 아파트 가격은 "12억 3,000만" 처럼 말하므로 만원 단위가 오입력이 가장 적다.
 */
export function MoneyInput({
  value,
  onChange,
  placeholder,
  id,
}: {
  /** 원 단위 */
  value: number;
  onChange: (won: number) => void;
  placeholder?: string;
  id?: string;
}) {
  const [text, setText] = useState(value > 0 ? String(Math.round(value / 10_000)) : '');

  return (
    <div>
      <div className="relative">
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          placeholder={placeholder ?? '예: 125000'}
          onChange={(e) => {
            const raw = e.target.value.replace(/[^\d]/g, '');
            setText(raw);
            onChange(raw ? Number(raw) * 10_000 : 0);
          }}
          className="tabular pr-12"
        />
        <span className="text-muted-foreground pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
          만원
        </span>
      </div>
      {value > 0 ? (
        <p className="text-muted-foreground mt-1 text-[11px]">= {formatKrw(value)}</p>
      ) : null}
    </div>
  );
}

/** 시군구 검색 콤보박스 */
export function RegionPicker({
  value,
  onSelect,
  placeholder = '시군구 검색 (예: 송파, 분당)',
}: {
  value?: string;
  onSelect: (region: SigunguInfo) => void;
  placeholder?: string;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const results = useMemo(() => searchSigungu(query, 30), [query]);
  const selected = value ? searchSigungu(value, 1)[0] : undefined;

  return (
    <div className="relative">
      <div className="relative">
        <Input
          value={query}
          placeholder={selected ? `${selected.sidoShort} ${selected.name}` : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            blurTimer.current = setTimeout(() => setOpen(false), 150);
          }}
          className="pr-8"
        />
        {query ? (
          <button
            type="button"
            className="text-muted-foreground absolute top-1/2 right-2 -translate-y-1/2"
            onClick={() => setQuery('')}
            aria-label="지우기"
          >
            <X className="size-4" />
          </button>
        ) : (
          <ChevronsUpDown className="text-muted-foreground pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2" />
        )}
      </div>

      {open && results.length > 0 ? (
        <ul className="thin-scrollbar bg-popover absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md border p-1 shadow-md">
          {results.map((r) => (
            <li key={r.code}>
              <button
                type="button"
                className="hover:bg-accent flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  if (blurTimer.current) clearTimeout(blurTimer.current);
                  onSelect(r);
                  setQuery('');
                  setOpen(false);
                }}
              >
                <span>
                  {r.sidoShort} {r.name}
                </span>
                <span className="text-muted-foreground flex items-center gap-1.5 text-xs">
                  {r.code}
                  {value === r.code ? <Check className="size-3" /> : null}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** 리스트 아이템 카드 헤더 (삭제 버튼 포함) */
export function ItemHeader({
  title,
  subtitle,
  onRemove,
}: {
  title: string;
  subtitle?: string;
  onRemove: () => void;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-2">
      <div>
        <div className="font-medium">{title || '(이름 없음)'}</div>
        {subtitle ? <div className="text-muted-foreground text-xs">{subtitle}</div> : null}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive rounded p-1 transition-colors"
        aria-label="삭제"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
