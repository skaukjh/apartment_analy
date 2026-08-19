'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  Loader2,
  MessageCircle,
  Plus,
  Save,
  Send,
  Unplug,
  Wand2,
} from 'lucide-react';
import { formatKrw } from '@/lib/format';
import { REGULATION_AS_OF, regulationOf } from '@/lib/analysis/regulation';
import type { Holding, TargetApartment, UserConfig, WatchRegion } from '@/lib/types';
import type { SigunguInfo } from '@/lib/regions';
import { SectionCard, EmptyHint } from '@/components/ui-bits';
import { Field, ItemHeader, MoneyInput, RegionPicker } from '@/components/form-bits';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

interface Props {
  initialConfig: UserConfig;
  kakao: { connected: boolean; expiresAt?: string; reason?: string };
  flags: Record<'supabase' | 'molit' | 'ecos' | 'reb' | 'naver' | 'kakao', boolean>;
}

const uid = () => Math.random().toString(36).slice(2, 10);

interface FillReport {
  filled: Array<{ owner: string; field: string; label: string; value: number; basis: string }>;
  skipped: string[];
  householdNotes: string[];
  asOf: string;
}

export function SettingsClient({ initialConfig, kakao, flags }: Props) {
  const [config, setConfig] = useState<UserConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [filling, setFilling] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [fillReport, setFillReport] = useState<FillReport | null>(null);
  const params = useSearchParams();

  // 카카오 콜백 결과 토스트
  useEffect(() => {
    const status = params.get('kakao');
    if (status === 'connected') toast.success('카카오 계정이 연결되었습니다.');
    if (status === 'error') toast.error(params.get('message') ?? '카카오 연결에 실패했습니다.');
  }, [params]);

  const patch = (p: Partial<UserConfig>) => setConfig((c) => ({ ...c, ...p }));

  /** 등록된 보유·목표 아파트의 규제 지정 현황 */
  const regulationHits = [...config.holdings, ...config.targets]
    .filter((a) => /^\d{5}$/.test(a.lawdCd))
    .map((a) => ({
      name: `${a.complexName || '(이름 없음)'} · ${a.sigungu}`,
      status: regulationOf(a.lawdCd),
    }));

  /**
   * 자동 채움 — 최소 입력값(지역·면적·취득일·취득가액)만으로 나머지를 현재 기준으로 계산한다.
   * @param overwrite 이미 값이 있는 필드까지 덮어쓸지
   */
  async function autoFill(
    scope: 'all' | 'holding' | 'target' | 'household',
    overwrite: boolean,
    id?: string,
  ) {
    setFilling(scope + (id ?? ''));
    try {
      const res = await fetch('/api/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config, overwrite, scope, id }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '자동 계산 실패');

      setConfig(json.config);
      setFillReport({
        filled: json.filled ?? [],
        skipped: json.skipped ?? [],
        householdNotes: json.householdNotes ?? [],
        asOf: json.context?.asOf ?? new Date().toISOString(),
      });

      const count = (json.filled ?? []).length;
      if (count > 0) {
        toast.success(
          `${count}개 항목을 현재 기준으로 계산해 채웠습니다. 아래에서 근거를 확인하세요.`,
        );
      } else {
        toast.info('채울 항목이 없습니다. 덮어쓰기를 켜면 기존 값도 다시 계산합니다.');
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setFilling(null);
    }
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '저장 실패');
      setConfig(json.config);
      toast.success('설정을 저장했습니다.');
      if (json.warning) toast.warning(json.warning, { duration: 8000 });
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setSending(true);
    try {
      const res = await fetch('/api/kakao/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (json.ok && !json.skippedReason) toast.success(`${json.messageCount}건 전송 완료`);
      else toast.error(json.error ?? json.skippedReason ?? '전송 실패');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function disconnect() {
    await fetch('/api/kakao/status', { method: 'DELETE' });
    toast.success('카카오 연결을 해제했습니다.');
    location.reload();
  }

  /* ---------------- 보유 아파트 ---------------- */

  const addHolding = () =>
    patch({
      holdings: [
        ...config.holdings,
        {
          kind: 'holding',
          id: uid(),
          complexName: '',
          sido: '',
          sigungu: '',
          dong: '',
          lawdCd: '',
          areaM2: 84.98,
          acquiredAt: new Date().toISOString().slice(0, 10),
          acquisitionPrice: 0,
          acquisitionCost: 0,
          capitalExpenditure: 0,
          residenceMonths: 0,
          loanBalance: 0,
          loanRate: 4.0,
          leaseDeposit: 0,
        },
      ],
    });

  const updateHolding = (id: string, p: Partial<Holding>) =>
    patch({ holdings: config.holdings.map((h) => (h.id === id ? { ...h, ...p } : h)) });

  const removeHolding = (id: string) =>
    patch({ holdings: config.holdings.filter((h) => h.id !== id) });

  /* ---------------- 목표 아파트 ---------------- */

  const addTarget = () =>
    patch({
      targets: [
        ...config.targets,
        {
          kind: 'target',
          id: uid(),
          complexName: '',
          sido: '',
          sigungu: '',
          dong: '',
          lawdCd: '',
          areaM2: 84.98,
          priority: config.targets.length + 1,
        },
      ],
    });

  const updateTarget = (id: string, p: Partial<TargetApartment>) =>
    patch({ targets: config.targets.map((t) => (t.id === id ? { ...t, ...p } : t)) });

  const removeTarget = (id: string) =>
    patch({ targets: config.targets.filter((t) => t.id !== id) });

  /* ---------------- 관심 지역 ---------------- */

  const addRegion = (r: SigunguInfo) => {
    if (config.watchRegions.some((w) => w.lawdCd === r.code)) {
      toast.info('이미 등록된 지역입니다.');
      return;
    }
    const region: WatchRegion = {
      id: uid(),
      name: `${r.sidoShort} ${r.name}`,
      sido: r.sido,
      sigungu: r.name,
      lawdCd: r.code,
      keywords: [],
    };
    patch({ watchRegions: [...config.watchRegions, region] });
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-24">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">설정</h1>
        <p className="text-muted-foreground text-sm">
          입력한 값은 대시보드의 갭 계산·세금 시뮬레이션·호재 추적에 즉시 반영됩니다.
        </p>
      </div>

      {!flags.supabase ? (
        <Alert>
          <AlertTitle>Supabase 미연결</AlertTitle>
          <AlertDescription>
            설정이 서버 메모리에만 저장되어 배포·재시작 시 사라집니다. 카카오 브리핑 자동 발송을
            쓰려면 <code>NEXT_PUBLIC_SUPABASE_URL</code> 과 <code>SUPABASE_SERVICE_ROLE_KEY</code>{' '}
            를 설정하세요.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* 자동 채움 */}
      <SectionCard
        title={
          <>
            <Wand2 className="size-4" /> 자동 채우기
          </>
        }
        description="단지명·시군구·전용면적·취득일·취득가액만 넣고 누르면, 나머지는 오늘 기준 세율·시세·금리로 계산해 채웁니다. 채운 값은 모두 직접 수정할 수 있습니다."
        action={
          <Button size="sm" onClick={() => autoFill('all', overwrite)} disabled={filling !== null}>
            {filling === 'all' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            전체 자동 계산
          </Button>
        }
      >
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
            <div>
              <Label className="text-sm">이미 입력된 값도 덮어쓰기</Label>
              <p className="text-muted-foreground mt-0.5 text-[11px]">
                끄면 비어 있는 값만 채웁니다. 켜면 직접 입력한 값도 최신 계산으로 대체합니다.
              </p>
            </div>
            <Switch checked={overwrite} onCheckedChange={setOverwrite} />
          </div>

          <div className="text-muted-foreground grid gap-2 text-[11px] sm:grid-cols-2">
            <div className="rounded-md border p-2.5">
              <div className="text-foreground mb-1 font-medium">직접 넣어야 하는 값</div>
              단지명 · 시군구 · 전용면적 · 취득일 · 취득가액 · 대출 잔액 · 보증금
            </div>
            <div className="rounded-md border p-2.5">
              <div className="text-foreground mb-1 font-medium">자동으로 계산되는 값</div>
              취득 부대비용(취득세+중개보수+법무비) · 실거주 개월 · 대출 금리 · 현재 호가 · 세대
              프로필(주택 수·조정대상지역·일시적 2주택)
            </div>
          </div>

          {fillReport ? (
            <div className="bg-muted/30 rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-xs font-semibold">
                  계산 결과 ({new Date(fillReport.asOf).toLocaleString('ko-KR')} 기준)
                </span>
                <button
                  type="button"
                  onClick={() => setFillReport(null)}
                  className="text-muted-foreground text-[11px] hover:underline"
                >
                  닫기
                </button>
              </div>

              {fillReport.filled.length > 0 ? (
                <ul className="space-y-1.5">
                  {fillReport.filled.map((f, i) => (
                    <li key={i} className="text-[11px] leading-relaxed">
                      <span className="font-medium">
                        {f.owner} · {f.label}
                      </span>{' '}
                      <span className="tabular text-muted-foreground">
                        →{' '}
                        {f.field === 'loanRate'
                          ? `${f.value}%`
                          : f.field === 'residenceMonths'
                            ? `${f.value}개월`
                            : formatKrw(f.value)}
                      </span>
                      <div className="text-muted-foreground">{f.basis}</div>
                    </li>
                  ))}
                </ul>
              ) : null}

              {fillReport.householdNotes.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t pt-2">
                  {fillReport.householdNotes.map((n, i) => (
                    <li key={i} className="text-muted-foreground text-[11px] leading-relaxed">
                      • {n}
                    </li>
                  ))}
                </ul>
              ) : null}

              {fillReport.skipped.length > 0 ? (
                <ul className="mt-2 space-y-1 border-t pt-2">
                  {fillReport.skipped.map((s, i) => (
                    <li
                      key={i}
                      className="flex gap-1.5 text-[11px] leading-relaxed text-amber-600 dark:text-amber-400"
                    >
                      <AlertTriangle className="mt-0.5 size-3 shrink-0" />
                      <span>{s}</span>
                    </li>
                  ))}
                </ul>
              ) : null}

              <p className="text-muted-foreground mt-2 border-t pt-2 text-[11px]">
                자동 계산은 현행 세율과 최신 실거래·금리를 씁니다. 실제 납부한 금액이나 알고 있는
                호가가 있으면 그 값으로 바꾸는 편이 정확합니다.
              </p>
            </div>
          ) : null}
        </div>
      </SectionCard>

      {/* 보유 아파트 */}
      <SectionCard
        title="보유 아파트"
        description="단지명·시군구·전용면적·취득일·취득가액만 넣고 카드의 '자동 계산'을 누르면 나머지가 채워집니다."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => autoFill('holding', overwrite)}
              disabled={filling !== null || config.holdings.length === 0}
            >
              {filling === 'holding' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              자동 계산
            </Button>
            <Button size="sm" variant="outline" onClick={addHolding}>
              <Plus className="size-4" /> 추가
            </Button>
          </div>
        }
      >
        {config.holdings.length === 0 ? (
          <EmptyHint>보유 아파트를 추가하세요.</EmptyHint>
        ) : (
          <div className="space-y-4">
            {config.holdings.map((h) => (
              <div key={h.id} className="rounded-lg border p-4">
                <ItemHeader
                  title={h.complexName}
                  subtitle={h.lawdCd ? `${h.sigungu} · ${h.lawdCd}` : '지역 미선택'}
                  onRemove={() => removeHolding(h.id)}
                />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="단지명">
                    <Input
                      value={h.complexName}
                      placeholder="예: 헬리오시티"
                      onChange={(e) => updateHolding(h.id, { complexName: e.target.value })}
                    />
                  </Field>
                  <Field label="시군구" hint="실거래가 조회 기준입니다">
                    <RegionPicker
                      value={h.lawdCd}
                      onSelect={(r) =>
                        updateHolding(h.id, {
                          lawdCd: r.code,
                          sido: r.sido,
                          sigungu: r.name,
                        })
                      }
                    />
                  </Field>
                  <Field label="법정동" hint="선택 입력">
                    <Input
                      value={h.dong}
                      placeholder="예: 가락동"
                      onChange={(e) => updateHolding(h.id, { dong: e.target.value })}
                    />
                  </Field>
                  <Field label="전용면적 (㎡)" hint="85㎡ 초과 시 농어촌특별세가 붙습니다">
                    <Input
                      type="number"
                      step="0.01"
                      value={h.areaM2}
                      className="tabular"
                      onChange={(e) => updateHolding(h.id, { areaM2: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="취득일">
                    <Input
                      type="date"
                      value={h.acquiredAt}
                      onChange={(e) => updateHolding(h.id, { acquiredAt: e.target.value })}
                    />
                  </Field>
                  <Field label="실거주 개월 수" hint="1세대1주택 장기보유특별공제(거주)에 반영">
                    <Input
                      type="number"
                      value={h.residenceMonths}
                      className="tabular"
                      onChange={(e) =>
                        updateHolding(h.id, { residenceMonths: Number(e.target.value) })
                      }
                    />
                  </Field>
                  <Field label="취득가액">
                    <MoneyInput
                      value={h.acquisitionPrice}
                      onChange={(v) => updateHolding(h.id, { acquisitionPrice: v })}
                    />
                  </Field>
                  <Field label="취득 부대비용" hint="취득세·중개보수·법무비 합계 (필요경비)">
                    <MoneyInput
                      value={h.acquisitionCost}
                      onChange={(v) => updateHolding(h.id, { acquisitionCost: v })}
                    />
                  </Field>
                  <Field label="자본적 지출" hint="확장·새시 등 양도세 필요경비 인정분">
                    <MoneyInput
                      value={h.capitalExpenditure}
                      onChange={(v) => updateHolding(h.id, { capitalExpenditure: v })}
                    />
                  </Field>
                  <Field label="현재 호가" hint="비우면 최근 실거래 중앙값을 사용합니다">
                    <MoneyInput
                      value={h.manualPrice ?? 0}
                      onChange={(v) => updateHolding(h.id, { manualPrice: v || undefined })}
                    />
                  </Field>
                  <Field label="남은 대출 잔액">
                    <MoneyInput
                      value={h.loanBalance}
                      onChange={(v) => updateHolding(h.id, { loanBalance: v })}
                    />
                  </Field>
                  <Field label="대출 금리 (%)">
                    <Input
                      type="number"
                      step="0.01"
                      value={h.loanRate}
                      className="tabular"
                      onChange={(e) => updateHolding(h.id, { loanRate: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="세입자 보증금" hint="매도 시 반환해야 할 전세/월세 보증금">
                    <MoneyInput
                      value={h.leaseDeposit}
                      onChange={(v) => updateHolding(h.id, { leaseDeposit: v })}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 목표 아파트 */}
      <SectionCard
        title="목표 (갈아타기 대상) 아파트"
        description="여러 곳을 등록하면 실소요 자금이 적은 순으로 정렬해 보여줍니다. 호가를 비우면 최근 실거래 중앙값을 씁니다."
        action={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => autoFill('target', overwrite)}
              disabled={filling !== null || config.targets.length === 0}
            >
              {filling === 'target' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Wand2 className="size-4" />
              )}
              자동 계산
            </Button>
            <Button size="sm" variant="outline" onClick={addTarget}>
              <Plus className="size-4" /> 추가
            </Button>
          </div>
        }
      >
        {config.targets.length === 0 ? (
          <EmptyHint>목표 아파트를 추가하세요.</EmptyHint>
        ) : (
          <div className="space-y-4">
            {config.targets.map((t) => (
              <div key={t.id} className="rounded-lg border p-4">
                <ItemHeader
                  title={t.complexName}
                  subtitle={t.lawdCd ? `${t.sigungu} · ${t.lawdCd}` : '지역 미선택'}
                  onRemove={() => removeTarget(t.id)}
                />
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <Field label="단지명">
                    <Input
                      value={t.complexName}
                      placeholder="예: 반포자이"
                      onChange={(e) => updateTarget(t.id, { complexName: e.target.value })}
                    />
                  </Field>
                  <Field label="시군구">
                    <RegionPicker
                      value={t.lawdCd}
                      onSelect={(r) =>
                        updateTarget(t.id, { lawdCd: r.code, sido: r.sido, sigungu: r.name })
                      }
                    />
                  </Field>
                  <Field label="전용면적 (㎡)">
                    <Input
                      type="number"
                      step="0.01"
                      value={t.areaM2}
                      className="tabular"
                      onChange={(e) => updateTarget(t.id, { areaM2: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="현재 호가" hint="비우면 최근 실거래 중앙값을 사용합니다">
                    <MoneyInput
                      value={t.manualPrice ?? 0}
                      onChange={(v) => updateTarget(t.id, { manualPrice: v || undefined })}
                    />
                  </Field>
                  <Field label="우선순위" hint="1이 가장 높음">
                    <Input
                      type="number"
                      min={1}
                      value={t.priority}
                      className="tabular"
                      onChange={(e) => updateTarget(t.id, { priority: Number(e.target.value) })}
                    />
                  </Field>
                  <Field label="메모" className="sm:col-span-2 lg:col-span-1">
                    <Input
                      value={t.memo ?? ''}
                      placeholder="예: 한강뷰 로열동 우선"
                      onChange={(e) => updateTarget(t.id, { memo: e.target.value })}
                    />
                  </Field>
                </div>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 관심 지역 */}
      <SectionCard
        title="관심 지역"
        description="등록한 지역의 호재·뉴스를 추적하고, 실거래 원본까지 캐시해 신고가 분석에 사용합니다."
      >
        <div className="mb-3 max-w-md">
          <RegionPicker onSelect={addRegion} placeholder="지역을 검색해 추가하세요" />
        </div>
        {config.watchRegions.length === 0 ? (
          <EmptyHint>관심 지역이 없습니다.</EmptyHint>
        ) : (
          <div className="space-y-3">
            {config.watchRegions.map((w) => (
              <div key={w.id} className="rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{w.name}</span>
                    <Badge variant="outline" className="tabular text-[10px]">
                      {w.lawdCd}
                    </Badge>
                  </div>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() =>
                      patch({ watchRegions: config.watchRegions.filter((x) => x.id !== w.id) })
                    }
                  >
                    삭제
                  </Button>
                </div>
                <Field
                  label="뉴스 추적 키워드 (쉼표 구분)"
                  hint="비우면 '지역명 + 아파트/재개발/GTX' 로 자동 검색합니다"
                  className="mt-2"
                >
                  <Input
                    value={w.keywords.join(', ')}
                    placeholder="예: 재건축, GTX-C, 정비구역"
                    onChange={(e) =>
                      patch({
                        watchRegions: config.watchRegions.map((x) =>
                          x.id === w.id
                            ? {
                                ...x,
                                keywords: e.target.value
                                  .split(',')
                                  .map((s) => s.trim())
                                  .filter(Boolean),
                              }
                            : x,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* 세대 프로필 */}
      <SectionCard
        title="세대 프로필 (세금 계산 조건)"
        description="취득세 중과·양도세 비과세 판정에 사용됩니다. 정책은 자주 바뀌므로 실제 신고 전 확인이 필요합니다."
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => autoFill('household', true)}
            disabled={filling !== null}
          >
            {filling === 'household' ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Wand2 className="size-4" />
            )}
            등록 정보로 자동 설정
          </Button>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="세대 보유 주택 수" hint="갈아타기 대상 주택 제외, 현재 보유 기준">
            <Input
              type="number"
              min={0}
              value={config.household.ownedHouseCount}
              className="tabular"
              onChange={(e) =>
                patch({
                  household: { ...config.household, ownedHouseCount: Number(e.target.value) },
                })
              }
            />
          </Field>
          <Field label="올해 다른 양도소득 (원)" hint="기본공제 250만원 중복 적용을 막습니다">
            <MoneyInput
              value={config.household.otherCapitalGainThisYear}
              onChange={(v) =>
                patch({ household: { ...config.household, otherCapitalGainThisYear: v } })
              }
            />
          </Field>
        </div>

        <Separator className="my-4" />

        <h4 className="mb-1 text-sm font-semibold">자금 · 소득</h4>
        <p className="text-muted-foreground mb-3 text-[11px]">
          보유 아파트가 없어도 이 세 값만 넣으면 대출 가능액과 목표 집까지 필요한 현금을 계산합니다.
        </p>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="총 보유 현금·금융자산" hint="예적금·주식 등 동원 가능한 자금">
            <MoneyInput
              value={config.household.cashAssets}
              onChange={(v) => patch({ household: { ...config.household, cashAssets: v } })}
            />
          </Field>
          <Field label="세전 연 소득" hint="비우면 DSR 없이 LTV 한도만 계산합니다">
            <MoneyInput
              value={config.household.annualIncome}
              onChange={(v) => patch({ household: { ...config.household, annualIncome: v } })}
            />
          </Field>
          <Field label="기존 대출 연 상환액" hint="신용·전세대출 등의 연간 원리금 (DSR 차감)">
            <MoneyInput
              value={config.household.otherDebtAnnualPayment}
              onChange={(v) =>
                patch({ household: { ...config.household, otherDebtAnnualPayment: v } })
              }
            />
          </Field>
        </div>

        {regulationHits.length > 0 ? (
          <div className="mt-4 rounded-lg border p-3">
            <h4 className="mb-1.5 text-xs font-semibold">
              등록 지역 규제 현황{' '}
              <span className="text-muted-foreground font-normal">({REGULATION_AS_OF})</span>
            </h4>
            <ul className="space-y-1.5">
              {regulationHits.map((r) => (
                <li key={r.name} className="text-[11px]">
                  <span className="font-medium">{r.name}</span>{' '}
                  {r.status.badges.map((b) => (
                    <Badge
                      key={b}
                      variant={b === '비규제지역' ? 'secondary' : 'destructive'}
                      className="ml-1 text-[10px]"
                    >
                      {b}
                    </Badge>
                  ))}
                  {r.status.landPermit ? (
                    <p className="text-muted-foreground mt-0.5">
                      토지거래허가구역은 실거주 목적만 매수 가능하며 2년 실거주 의무가 붙습니다. 구
                      전체가 아니라 일부 구역만 지정되는 경우가 많으니 해당 단지 포함 여부를 꼭
                      확인하세요.
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <Separator className="my-4" />

        <div className="space-y-3">
          <ToggleRow
            label="보유 주택이 조정대상지역"
            hint="양도세 다주택 중과 판정 기준"
            checked={config.household.holdingIsRegulated}
            onChange={(v) => patch({ household: { ...config.household, holdingIsRegulated: v } })}
          />
          <ToggleRow
            label="목표 주택이 조정대상지역"
            hint="취득세 중과 판정 기준"
            checked={config.household.targetIsRegulated}
            onChange={(v) => patch({ household: { ...config.household, targetIsRegulated: v } })}
          />
          <ToggleRow
            label="일시적 2주택 특례 적용"
            hint="갈아타기(기존 주택 처분 예정)라면 켜두세요. 취득세 표준세율이 적용됩니다."
            checked={config.household.temporaryTwoHouse}
            onChange={(v) => patch({ household: { ...config.household, temporaryTwoHouse: v } })}
          />
          <ToggleRow
            label="생애최초 주택 구입"
            hint="취득세 최대 200만원 감면 (12억 이하)"
            checked={config.household.firstTimeBuyer}
            onChange={(v) => patch({ household: { ...config.household, firstTimeBuyer: v } })}
          />
          <ToggleRow
            label="다주택자 양도세 중과 적용"
            hint="중과 한시 배제 정책이 종료됐다면 켜세요. 기본세율 +20~30%p 가 가산됩니다."
            checked={config.household.applyMultiHouseSurcharge}
            onChange={(v) =>
              patch({ household: { ...config.household, applyMultiHouseSurcharge: v } })
            }
          />
        </div>
      </SectionCard>

      {/* 카카오 */}
      <SectionCard
        title={
          <>
            <MessageCircle className="size-4" /> 카카오톡 브리핑
          </>
        }
        description="카카오 '나에게 보내기' 메모 API 를 사용합니다. 사업자 등록이나 알림톡 심사가 필요 없습니다."
        badge={
          kakao.connected ? (
            <Badge variant="secondary">연결됨</Badge>
          ) : (
            <Badge variant="outline">미연결</Badge>
          )
        }
      >
        {!flags.kakao ? (
          <Alert>
            <AlertTitle>KAKAO_REST_API_KEY 미설정</AlertTitle>
            <AlertDescription>
              <a
                className="underline"
                href="https://developers.kakao.com"
                target="_blank"
                rel="noreferrer"
              >
                카카오 개발자센터
              </a>
              에서 앱을 만들고 REST API 키를 환경변수에 추가한 뒤, 카카오 로그인 활성화 및{' '}
              <code>talk_message</code> 동의항목을 켜세요.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {kakao.connected ? (
                <>
                  <Button size="sm" onClick={sendTest} disabled={sending}>
                    {sending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Send className="size-4" />
                    )}
                    지금 브리핑 보내기
                  </Button>
                  <Button size="sm" variant="outline" onClick={disconnect}>
                    <Unplug className="size-4" /> 연결 해제
                  </Button>
                </>
              ) : (
                <Button size="sm" render={<a href="/api/kakao/connect" />} nativeButton={false}>
                  카카오 계정 연결
                </Button>
              )}
            </div>

            {kakao.expiresAt ? (
              <p className="text-muted-foreground text-xs">
                액세스 토큰 만료: {new Date(kakao.expiresAt).toLocaleString('ko-KR')} (만료 시 자동
                갱신)
              </p>
            ) : null}

            <ToggleRow
              label="일일 브리핑 자동 발송"
              hint="Vercel Cron 이 매일 정해진 시각에 호출합니다"
              checked={config.kakaoBriefingEnabled}
              onChange={(v) => patch({ kakaoBriefingEnabled: v })}
            />

            <Field
              label="발송 희망 시각 (KST)"
              hint="실제 발송 시각은 vercel.json 의 cron schedule 을 함께 수정해야 반영됩니다"
            >
              <Input
                type="number"
                min={0}
                max={23}
                value={config.briefingHour}
                className="tabular max-w-24"
                onChange={(e) => patch({ briefingHour: Number(e.target.value) })}
              />
            </Field>
          </div>
        )}
      </SectionCard>

      {/* 데이터 소스 키 상태 */}
      <SectionCard
        title="외부 데이터 소스 키"
        description="키가 없는 소스는 해당 섹션이 비활성화됩니다. Vercel 프로젝트의 환경변수에 추가하세요."
      >
        <div className="grid gap-2 sm:grid-cols-2">
          <KeyRow
            ok={flags.molit}
            label="국토교통부 실거래가"
            env="DATA_GO_KR_SERVICE_KEY"
            url="https://www.data.go.kr/data/15126469/openapi.do"
          />
          <KeyRow
            ok={flags.ecos}
            label="한국은행 ECOS"
            env="ECOS_API_KEY"
            url="https://ecos.bok.or.kr/api/#/AuthKeyApply"
          />
          <KeyRow
            ok={flags.reb}
            label="한국부동산원 R-ONE"
            env="REB_API_KEY"
            url="https://www.reb.or.kr/r-one/portal/openapi/openApiIntro.do"
          />
          <KeyRow
            ok={flags.naver}
            label="네이버 뉴스 검색"
            env="NAVER_CLIENT_ID / SECRET"
            url="https://developers.naver.com/apps/#/register"
          />
          <KeyRow
            ok={flags.kakao}
            label="카카오 메시지"
            env="KAKAO_REST_API_KEY"
            url="https://developers.kakao.com"
          />
          <KeyRow
            ok={flags.supabase}
            label="Supabase (설정·캐시 저장)"
            env="SUPABASE_SERVICE_ROLE_KEY"
            url="https://supabase.com/dashboard"
          />
        </div>

        <Separator className="my-4" />

        <Field
          label="실거래 데이터 수집 명령"
          hint="최초 1회 백필 후에는 Vercel Cron 이 매일 증분 갱신합니다. remaining 이 0이 될 때까지 반복 호출하세요."
        >
          <Textarea
            readOnly
            rows={3}
            className="font-mono text-xs"
            value={`# 과거 데이터 백필 (반복 호출)\ncurl "https://<앱주소>/api/cron/backfill?secret=<CRON_SECRET>&regions=6"\n\n# 최근 3개월 증분 갱신\ncurl "https://<앱주소>/api/cron/refresh?secret=<CRON_SECRET>"`}
          />
        </Field>
      </SectionCard>

      {/* 저장 바 */}
      <div className="bg-background/95 fixed inset-x-0 bottom-0 z-30 border-t backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3">
          <span className="text-muted-foreground text-xs">
            보유 {config.holdings.length} · 목표 {config.targets.length} · 관심지역{' '}
            {config.watchRegions.length}
          </span>
          <Button onClick={save} disabled={saving}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            저장
          </Button>
        </div>
      </div>
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
      <div>
        <Label className="text-sm">{label}</Label>
        {hint ? <p className="text-muted-foreground mt-0.5 text-[11px]">{hint}</p> : null}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function KeyRow({ ok, label, env, url }: { ok: boolean; label: string; env: string; url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="hover:bg-muted/50 flex items-center justify-between rounded-lg border p-3 transition-colors"
    >
      <div>
        <div className="text-sm font-medium">{label}</div>
        <code className="text-muted-foreground text-[11px]">{env}</code>
      </div>
      <Badge variant={ok ? 'secondary' : 'outline'}>{ok ? '설정됨' : '없음'}</Badge>
    </a>
  );
}
