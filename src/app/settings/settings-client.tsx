'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  History,
  Loader2,
  MessageCircle,
  Plus,
  RotateCcw,
  Save,
  Send,
  Unplug,
  Wand2,
} from 'lucide-react';
import { formatArea, formatKrw } from '@/lib/format';
import { cn } from '@/lib/utils';
import { REGULATION_AS_OF, regulationOf } from '@/lib/analysis/regulation';
import {
  REDEVELOPMENT_STAGES,
  type Holding,
  type TargetApartment,
  type UserConfig,
  type WatchRegion,
} from '@/lib/types';
import type { SigunguInfo } from '@/lib/regions';
import { SectionCard, EmptyHint } from '@/components/ui-bits';
import { isTargetEnabled } from '@/lib/analysis/target-pool';
import { Field, ItemHeader, MoneyInput, RegionPicker } from '@/components/form-bits';
import { ComplexSearch, type ComplexPick } from '@/components/settings/complex-search';
import { PolicyAlertBanner } from '@/components/settings/policy-alert-banner';
import { AreaTypeSelect } from '@/components/settings/area-type-select';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Separator } from '@/components/ui/separator';

export interface KakaoRecipientView {
  id: string;
  label: string;
  nickname?: string;
  enabled: boolean;
  expiresAt: string;
  expired: boolean;
}

interface Props {
  initialConfig: UserConfig;
  kakao: { connected: boolean; reason?: string; recipients: KakaoRecipientView[] };
  /** 로그인 계정 정보 (설정은 로그인해야 진입 가능) */
  account: { email: string; canImportLegacy: boolean; isAdmin: boolean };
  flags: Record<'supabase' | 'molit' | 'ecos' | 'reb' | 'naver' | 'kakao' | 'telegram', boolean>;
}

const uid = () => Math.random().toString(36).slice(2, 10);

interface FillReport {
  filled: Array<{
    owner: string;
    field: string;
    label: string;
    value: number;
    /** 숫자가 아닌 값 (예: 재건축 단계) — 있으면 그대로 보여준다 */
    text?: string;
    basis: string;
  }>;
  skipped: string[];
  householdNotes: string[];
  asOf: string;
}

/** 관리자용 — 가입 승인 대기 목록. 시간 제한 없이 언제든 승인/취소할 수 있다. */
function AdminApprovalPanel() {
  const [users, setUsers] = useState<
    Array<{ id: string; email: string; createdAt: string; approved: boolean; isAdmin: boolean }>
  >([]);
  const [loaded, setLoaded] = useState(false);

  async function refresh() {
    const j = await fetch('/api/admin/users')
      .then((r) => r.json())
      .catch(() => null);
    if (j?.ok) setUsers(j.users);
    setLoaded(true);
  }

  useEffect(() => {
    const id = setTimeout(() => void refresh(), 0);
    return () => clearTimeout(id);
  }, []);

  async function setApprove(userId: string, approve: boolean) {
    const j = await fetch('/api/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId, approve }),
    }).then((r) => r.json());
    if (j.ok) {
      toast.success(approve ? '승인했습니다.' : '승인을 취소했습니다.');
      void refresh();
    } else toast.error(j.error ?? '실패');
  }

  const pending = users.filter((u) => !u.approved);
  if (!loaded || users.length === 0) return null;

  return (
    <SectionCard
      title="가입 승인 (관리자)"
      description="신규 가입은 승인 전까지 열람만 가능합니다. 언제든 승인·취소할 수 있습니다."
      badge={pending.length > 0 ? <Badge>{pending.length}명 대기</Badge> : undefined}
    >
      <ul className="space-y-2">
        {users.map((u) => (
          <li key={u.id} className="flex items-center justify-between rounded border px-3 py-2">
            <span className="text-sm">
              {u.email}
              <span className="text-muted-foreground ml-2 text-xs">
                {u.createdAt.slice(0, 10)}
                {u.isAdmin ? ' · 관리자' : u.approved ? ' · 승인됨' : ' · 대기'}
              </span>
            </span>
            {u.isAdmin ? null : u.approved ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setApprove(u.id, false)}
              >
                승인 취소
              </Button>
            ) : (
              <Button type="button" size="sm" onClick={() => setApprove(u.id, true)}>
                승인
              </Button>
            )}
          </li>
        ))}
      </ul>
    </SectionCard>
  );
}

export function SettingsClient({ initialConfig, kakao, account, flags }: Props) {
  const [config, setConfig] = useState<UserConfig>(initialConfig);
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [filling, setFilling] = useState<string | null>(null);
  const [overwrite, setOverwrite] = useState(false);
  const [fillReport, setFillReport] = useState<FillReport | null>(null);
  const [recipients, setRecipients] = useState<KakaoRecipientView[]>(kakao.recipients);
  const [newRecipientLabel, setNewRecipientLabel] = useState('');
  /** 오늘 API 호출량 (소스 키 → 건수). null 이면 집계 테이블 미적용 */
  const [apiUsage, setApiUsage] = useState<Record<string, number> | null>(null);
  /** 설정 히스토리 — 잘못 저장했을 때 카드 단위로 되돌리기 위한 이전 저장본들 */
  const [history, setHistory] = useState<Array<{ savedAt: string; config: UserConfig }> | null>(
    null,
  );
  const [historyOpenFor, setHistoryOpenFor] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const params = useSearchParams();

  // 소스 키 섹션에 "오늘 N건 사용"을 보여주기 위한 자체 집계 조회
  useEffect(() => {
    const id = setTimeout(() => {
      void fetch('/api/usage')
        .then((r) => r.json())
        .then((j) => {
          if (j?.ok && j.available) {
            const map: Record<string, number> = {};
            for (const row of j.usage as Array<{ source: string; count: number }>) {
              map[row.source] = row.count;
            }
            setApiUsage(map);
          }
        })
        .catch(() => {});
    }, 0);
    return () => clearTimeout(id);
  }, []);

  // 카카오 콜백 결과 토스트
  useEffect(() => {
    const status = params.get('kakao');
    if (status === 'connected') {
      toast.success(`${params.get('name') ?? '카카오 계정'} 연결 완료`);
      // 콜백으로 돌아온 직후에는 서버 프롭이 낡았을 수 있어 최신 목록을 다시 받는다
      void fetch('/api/kakao/status')
        .then((r) => r.json())
        .then((j) => j.ok && setRecipients(j.recipients ?? []))
        .catch(() => {});
    }
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
    /** setConfig 직후에는 config 클로저가 낡아 있으므로, 방금 만든 설정을 직접 넘긴다 */
    cfgOverride?: UserConfig,
  ) {
    setFilling(scope + (id ?? ''));
    try {
      const res = await fetch('/api/autofill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfgOverride ?? config, overwrite, scope, id }),
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
      const reports: Array<{ recipient: string; ok: boolean; error?: string }> = json.reports ?? [];

      if (json.ok && !json.skippedReason) {
        const names = reports.map((r) => r.recipient).join(', ');
        toast.success(`${reports.length || 1}명(${names})에게 각 ${json.messageCount}건 전송 완료`);
      } else if (reports.some((r) => r.ok)) {
        toast.warning(
          `일부만 전송됨 — ${reports.map((r) => `${r.recipient}: ${r.ok ? '성공' : '실패'}`).join(', ')}`,
          { duration: 9000 },
        );
      } else {
        toast.error(json.error ?? json.skippedReason ?? '전송 실패', { duration: 9000 });
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  /* ---------------- 텔레그램 ---------------- */
  const [tgDetecting, setTgDetecting] = useState(false);
  const [tgTesting, setTgTesting] = useState(false);
  const [tgChats, setTgChats] = useState<Array<{ chatId: string; title: string; type: string }>>(
    [],
  );
  const [tgBot, setTgBot] = useState<{ username?: string }>({});

  async function detectTelegram() {
    setTgDetecting(true);
    try {
      const res = await fetch('/api/telegram/detect');
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '감지 실패');
      setTgChats(json.chats ?? []);
      setTgBot(json.bot ?? {});
      if ((json.chats ?? []).length === 0) {
        toast.info(
          '감지된 대화가 없습니다. 봇에게 아무 메시지나 보내거나 그룹에 초대한 뒤 다시 시도하세요.',
          { duration: 8000 },
        );
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTgDetecting(false);
    }
  }

  async function testTelegram() {
    setTgTesting(true);
    try {
      const res = await fetch('/api/telegram/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chatId: config.telegramChatId }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '테스트 발송 실패');
      toast.success('텔레그램으로 테스트 메시지를 보냈습니다. 방을 확인하세요.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setTgTesting(false);
    }
  }

  async function disconnect(id?: string) {
    const res = await fetch(`/api/kakao/status${id ? `?id=${encodeURIComponent(id)}` : ''}`, {
      method: 'DELETE',
    });
    const json = await res.json();
    if (json.ok) {
      setRecipients(json.recipients ?? []);
      toast.success('카카오 연결을 해제했습니다.');
    } else {
      toast.error(json.error ?? '해제에 실패했습니다.');
    }
  }

  async function toggleRecipient(id: string, enabled: boolean) {
    const res = await fetch('/api/kakao/status', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, enabled }),
    });
    const json = await res.json();
    if (json.ok) setRecipients(json.recipients ?? []);
    else toast.error(json.error ?? '변경에 실패했습니다.');
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

  /** 카드의 이전 내역 패널 토글 — 처음 열 때 서버에서 히스토리를 받아온다 */
  async function toggleHistory(cardId: string) {
    if (historyOpenFor === cardId) {
      setHistoryOpenFor(null);
      return;
    }
    if (history === null) {
      setHistoryLoading(true);
      try {
        const j = await fetch('/api/config?action=history').then((r) => r.json());
        if (!j.ok) throw new Error(j.error ?? '이전 내역을 불러오지 못했습니다.');
        setHistory(j.history ?? []);
      } catch (e) {
        toast.error((e as Error).message);
        setHistoryLoading(false);
        return;
      }
      setHistoryLoading(false);
    }
    setHistoryOpenFor(cardId);
  }

  /** 히스토리에서 이 카드의 서로 다른 버전만 뽑는다 (연속 중복 제거) */
  function cardVersions<T extends { id: string }>(
    pickList: (c: UserConfig) => T[],
    cardId: string,
  ): Array<{ savedAt: string; item: T }> {
    if (!history) return [];
    const out: Array<{ savedAt: string; item: T }> = [];
    let prevJson = '';
    for (const h of history) {
      const item = pickList(h.config).find((x) => x.id === cardId);
      if (!item) continue;
      const json = JSON.stringify(item);
      if (json === prevJson) continue;
      prevJson = json;
      out.push({ savedAt: h.savedAt, item });
    }
    return out;
  }

  /** 섹션 전체 비우기 — 저장 버튼을 누르기 전까지는 서버에 반영되지 않는다 */
  const resetHoldings = () => {
    if (!window.confirm(`보유 아파트 ${config.holdings.length}건의 입력을 모두 지울까요?`)) return;
    patch({ holdings: [] });
    toast.info('보유 아파트 입력을 비웠습니다. 저장을 눌러야 반영됩니다.');
  };

  const resetTargets = () => {
    if (!window.confirm(`목표 아파트 ${config.targets.length}건의 입력을 모두 지울까요?`)) return;
    patch({ targets: [] });
    toast.info('목표 아파트 입력을 비웠습니다. 저장을 눌러야 반영됩니다.');
  };

  /**
   * 단지 검색 결과로 입력값을 채운다.
   * 채우는 시세는 실거래 중앙값이다 (호가 아님). 사용자가 이어서 손볼 수 있게 둔다.
   */
  /**
   * 단지를 고르면 건축물대장에서 총 세대수·용적률·대지지분을 바로 채운다.
   * 실패해도 조용히 넘어간다 — 선택 자체를 막을 이유는 없고, 값은 직접 입력하거나
   * "자동 계산"으로 다시 시도할 수 있다.
   */
  const fillSpecFor = async (
    kind: 'holding' | 'target',
    id: string,
    ref: { complexName: string; lawdCd: string; sido?: string; sigungu?: string; dong?: string },
  ) => {
    if (!ref.complexName || !/^\d{5}$/.test(ref.lawdCd)) return;
    const qs = new URLSearchParams({
      lawdCd: ref.lawdCd,
      name: ref.complexName,
      sido: ref.sido ?? '',
      sigungu: ref.sigungu ?? '',
      dong: ref.dong ?? '',
    });
    const j = await fetch(`/api/complex/spec?${qs}`)
      .then((r) => r.json())
      .catch(() => null);
    const s = j?.spec;
    if (!s || (!s.totalHouseholds && !s.floorAreaRatio)) return;

    const patchValues = {
      ...(s.totalHouseholds ? { totalHouseholds: s.totalHouseholds } : {}),
      ...(s.floorAreaRatio ? { floorAreaRatio: s.floorAreaRatio } : {}),
      ...(s.landShareM2 ? { landShareM2: s.landShareM2 } : {}),
    };
    if (kind === 'holding') updateHolding(id, patchValues);
    else updateTarget(id, patchValues);

    const parts = [
      s.totalHouseholds ? `${s.totalHouseholds.toLocaleString('ko-KR')}세대` : null,
      s.floorAreaRatio ? `용적률 ${s.floorAreaRatio}%` : null,
      s.landShareM2 ? `대지지분 ${s.landShareM2}㎡` : null,
    ].filter(Boolean);
    toast.success(`단지 정보를 채웠습니다 — ${parts.join(' · ')} (건축물대장 ${s.source})`, {
      description: '대장 등록명이 옆 단지와 묶인 경우가 있어 값이 실제와 다르면 직접 고치세요.',
    });
  };

  const applyHoldingPick = (id: string, pick: ComplexPick) => {
    const next: UserConfig = {
      ...config,
      holdings: config.holdings.map((h) =>
        h.id === id
          ? {
              ...h,
              complexName: pick.complexName,
              dong: pick.dong,
              areaM2: pick.areaM2,
              builtYear: pick.builtYear,
              manualPrice: pick.price,
            }
          : h,
      ),
    };
    setConfig(next);
    toast.success(
      `${pick.complexName} ${formatArea(pick.areaM2)} — 실거래 중앙값 ${formatKrw(pick.price)}으로 채웠습니다 (표본 ${pick.tradeCount}건, 최근 ${pick.latestDealDate})`,
    );
    // 취득일이 이미 입력돼 있으면 취득가액·실거주 개월·금리까지 이어서 자동 계산한다
    void autoFill('holding', false, id, next);
    // 단지 정보(세대수·용적률·대지지분)도 곧바로 채운다
    const picked = next.holdings.find((x) => x.id === id);
    if (picked) void fillSpecFor('holding', id, picked);
  };

  const applyTargetPick = (id: string, pick: ComplexPick) => {
    const next: UserConfig = {
      ...config,
      targets: config.targets.map((t) =>
        t.id === id
          ? {
              ...t,
              complexName: pick.complexName,
              dong: pick.dong,
              areaM2: pick.areaM2,
              builtYear: pick.builtYear,
              manualPrice: pick.price,
            }
          : t,
      ),
    };
    setConfig(next);
    toast.success(
      `${pick.complexName} ${formatArea(pick.areaM2)} — 실거래 중앙값 ${formatKrw(pick.price)}으로 채웠습니다 (표본 ${pick.tradeCount}건, 최근 ${pick.latestDealDate})`,
    );
    // 단지 정보(세대수·용적률·대지지분)도 곧바로 채운다
    const picked = next.targets.find((x) => x.id === id);
    if (picked) void fillSpecFor('target', id, picked);
  };

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
          enabled: true,
        },
      ],
    });

  const updateTarget = (id: string, p: Partial<TargetApartment>) =>
    patch({ targets: config.targets.map((t) => (t.id === id ? { ...t, ...p } : t)) });

  const removeTarget = (id: string) =>
    patch({ targets: config.targets.filter((t) => t.id !== id) });

  /* 목표 아파트 순서 이동 — 배열 순서를 바꾸고 우선순위를 순서대로(1부터) 다시 매긴다.
     우선순위가 갭 카드·브리핑의 1순위 판정 기준이므로 화면 순서와 항상 일치시킨다. */
  const moveTarget = (id: string, dir: -1 | 1) => {
    const idx = config.targets.findIndex((t) => t.id === id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= config.targets.length) return;
    const arr = [...config.targets];
    [arr[idx], arr[to]] = [arr[to], arr[idx]];
    patch({ targets: arr.map((t, i) => ({ ...t, priority: i + 1 })) });
  };

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

  /** 레거시(로그인 도입 전) 공용 설정을 내 계정으로 복사 */
  async function importLegacy() {
    try {
      const res = await fetch('/api/config?action=import-legacy', { method: 'POST' });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error ?? '가져오기 실패');
      setConfig(json.config);
      toast.success('기존 설정을 내 계정으로 가져왔습니다.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function logout() {
    const { getBrowserSupabase } = await import('@/lib/auth/client');
    await getBrowserSupabase().auth.signOut();
    // 서버 컴포넌트가 세션 쿠키를 다시 읽어야 하므로 전체 리로드가 필요하다
    window.location.assign(new URL('/', window.location.origin).toString());
  }

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 pb-24">
      {/* 재건축 단계 입력의 추천 목록 — 보유·목표 카드가 함께 쓴다.
          자동 채움이 못 찾은 단지도 사용자가 여기서 골라 넣을 수 있다. */}
      <datalist id="redevelopment-stages">
        {REDEVELOPMENT_STAGES.map((s) => (
          <option key={s} value={s} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">설정</h1>
          <p className="text-muted-foreground text-sm">
            입력한 값은 대시보드의 갭 계산·세금 시뮬레이션·호재 추적에 즉시 반영됩니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{account.email}</span>
          <Button type="button" variant="outline" size="sm" onClick={logout}>
            로그아웃
          </Button>
        </div>
      </div>

      {/* 정책 변경 감지 — API 가 관리자에게만 경고를 준다 (일반 회원은 빈 목록) */}
      {account.isAdmin ? <PolicyAlertBanner /> : null}

      {account.isAdmin ? <AdminApprovalPanel /> : null}

      {account.canImportLegacy ? (
        <Alert>
          <AlertTitle>이 계정에는 아직 설정이 없습니다</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center gap-3">
            <span>로그인 도입 전에 쓰던 공용 설정을 이 계정으로 가져올 수 있습니다.</span>
            <Button type="button" size="sm" onClick={importLegacy}>
              기존 설정 가져오기
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

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
                        {f.text
                          ? f.text
                          : f.field === 'loanRate' || f.field === 'floorAreaRatio'
                            ? `${f.value}%`
                            : f.field === 'residenceMonths'
                              ? `${f.value}개월`
                              : f.field === 'totalHouseholds'
                                ? `${f.value.toLocaleString('ko-KR')}세대`
                                : f.field === 'landShareM2'
                                  ? `${f.value}㎡`
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
            <Button
              size="sm"
              variant="ghost"
              onClick={resetHoldings}
              disabled={config.holdings.length === 0}
            >
              <RotateCcw className="size-4" /> 전체 초기화
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
                <div className="mb-3 space-y-2">
                  <ComplexSearch
                    lawdCd={h.lawdCd}
                    onPick={(pick) => applyHoldingPick(h.id, pick)}
                  />
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => autoFill('holding', overwrite, h.id)}
                      disabled={filling !== null}
                    >
                      {filling === `holding${h.id}` ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Wand2 className="size-4" />
                      )}
                      이 카드 자동 계산
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      onClick={() => void toggleHistory(h.id)}
                      disabled={historyLoading}
                    >
                      {historyLoading && historyOpenFor !== h.id ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <History className="size-4" />
                      )}
                      이전 내역
                    </Button>
                  </div>
                  {historyOpenFor === h.id ? (
                    <HistoryList
                      rows={cardVersions((c) => c.holdings, h.id).map(({ savedAt, item }) => ({
                        savedAt,
                        summary: `${item.complexName || '(이름 없음)'} ${formatArea(item.areaM2)} · 취득가 ${
                          item.acquisitionPrice > 0 ? formatKrw(item.acquisitionPrice) : '미입력'
                        } · 호가 ${item.manualPrice ? formatKrw(item.manualPrice) : '실거래 기준'} · 대출 ${
                          item.loanBalance > 0 ? formatKrw(item.loanBalance) : '없음'
                        }`,
                        restore: () => {
                          updateHolding(h.id, item);
                          setHistoryOpenFor(null);
                          toast.success(
                            '이전 값으로 되돌렸습니다. 저장을 눌러야 서버에 반영됩니다.',
                          );
                        },
                      }))}
                    />
                  ) : null}
                </div>
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
                  <Field label="총 세대수" hint="선택 — 갈아타기·시뮬레이션 카드에 표기">
                    <Input
                      type="number"
                      value={h.totalHouseholds ?? ''}
                      className="tabular"
                      onChange={(e) =>
                        updateHolding(h.id, {
                          totalHouseholds: Number(e.target.value) || undefined,
                        })
                      }
                    />
                  </Field>
                  <Field label="용적률 (%)" hint="선택 — 재건축 사업성 참고">
                    <Input
                      type="number"
                      step="0.1"
                      value={h.floorAreaRatio ?? ''}
                      className="tabular"
                      onChange={(e) =>
                        updateHolding(h.id, { floorAreaRatio: Number(e.target.value) || undefined })
                      }
                    />
                  </Field>
                  <Field label="대지지분 (㎡)" hint="선택 — 등기부 대지권 면적 기준 권장">
                    <Input
                      type="number"
                      step="0.01"
                      value={h.landShareM2 ?? ''}
                      className="tabular"
                      onChange={(e) =>
                        updateHolding(h.id, { landShareM2: Number(e.target.value) || undefined })
                      }
                    />
                  </Field>
                  <Field
                    label="재건축 단계"
                    hint={
                      h.redevelopmentSource ?? '선택 — 서울 단지는 정비몽땅에서 자동으로 채웁니다'
                    }
                  >
                    <Input
                      list="redevelopment-stages"
                      value={h.redevelopmentStage ?? ''}
                      placeholder="예: 조합설립인가"
                      onChange={(e) =>
                        updateHolding(h.id, {
                          redevelopmentStage: e.target.value || undefined,
                          redevelopmentSource: e.target.value ? '직접 입력' : undefined,
                        })
                      }
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
        description="여러 곳을 등록하면 실소요 자금이 적은 순으로 정렬해 보여줍니다. 목표 시세는 마지막 실거래가를 씁니다. 6개월 넘게 거래가 없으면 '목표 후보로 사용' 스위치가 자동으로 꺼지지만 카드는 남아 있어, 사유를 보고 직접 다시 켤 수 있습니다."
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
            <Button
              size="sm"
              variant="ghost"
              onClick={resetTargets}
              disabled={config.targets.length === 0}
            >
              <RotateCcw className="size-4" /> 전체 초기화
            </Button>
          </div>
        }
      >
        {config.targets.length === 0 ? (
          <EmptyHint>목표 아파트를 추가하세요.</EmptyHint>
        ) : (
          <div className="space-y-4">
            {config.targets.map((t, i) => (
              <div key={t.id} className="rounded-lg border p-4">
                <ItemHeader
                  title={t.complexName}
                  subtitle={t.lawdCd ? `${t.sigungu} · ${t.lawdCd}` : '지역 미선택'}
                  onRemove={() => removeTarget(t.id)}
                />
                {/* 순서 이동 — 순서가 곧 우선순위(1순위가 갭 카드·브리핑의 기준)가 된다 */}
                <div className="-mt-2 mb-2 flex items-center gap-1">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={i === 0}
                    onClick={() => moveTarget(t.id, -1)}
                    aria-label="위로 이동"
                  >
                    <ChevronUp className="size-4" /> 위로
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={i === config.targets.length - 1}
                    onClick={() => moveTarget(t.id, 1)}
                    aria-label="아래로 이동"
                  >
                    <ChevronDown className="size-4" /> 아래로
                  </Button>
                  <Badge variant="outline" className="text-[10px]">
                    {t.priority}순위
                  </Badge>
                  {!isTargetEnabled(t) ? (
                    <Badge variant="secondary" className="text-[10px]">
                      꺼짐
                    </Badge>
                  ) : null}
                  {/* 지우면 취득가·면적 입력이 사라진다. 계산에서만 빼고 입력은 남긴다.
                      최근 실거래가 6개월 넘게 없으면 이 스위치가 자동으로 꺼지는데,
                      그때도 카드는 목록에 남으므로 사유를 보고 직접 다시 켤 수 있다. */}
                  <label className="ml-auto flex cursor-pointer items-center gap-2 text-xs">
                    <Switch
                      checked={isTargetEnabled(t)}
                      onCheckedChange={(v) =>
                        /* 손으로 켜고 끈 순간부터는 자동 사유 문구를 지운다.
                           autoDisabledAt 은 남긴다 — 그게 있어야 같은 사유로 또 끄지 않는다. */
                        updateTarget(t.id, { enabled: v, autoDisabledReason: undefined })
                      }
                      aria-label="목표 후보로 사용"
                    />
                    <span className="text-muted-foreground">목표 후보로 사용</span>
                  </label>
                </div>
                {t.autoDisabledReason ? (
                  <p className="mb-2 rounded-md border border-amber-500/40 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                    {t.autoDisabledReason}. 그래도 후보로 쓰려면 위 스위치를 다시 켜세요 — 마지막
                    체결가를 그대로 씁니다.
                  </p>
                ) : null}
                <div className="mb-3 space-y-2">
                  <ComplexSearch lawdCd={t.lawdCd} onPick={(pick) => applyTargetPick(t.id, pick)} />
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => void toggleHistory(t.id)}
                    disabled={historyLoading}
                  >
                    {historyLoading && historyOpenFor !== t.id ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <History className="size-4" />
                    )}
                    이전 내역
                  </Button>
                  {historyOpenFor === t.id ? (
                    <HistoryList
                      rows={cardVersions((c) => c.targets, t.id).map(({ savedAt, item }) => ({
                        savedAt,
                        summary: `${item.complexName || '(이름 없음)'} ${formatArea(item.areaM2)} · 호가 ${
                          item.manualPrice ? formatKrw(item.manualPrice) : '실거래 기준'
                        } · 우선순위 ${item.priority}`,
                        restore: () => {
                          updateTarget(t.id, item);
                          setHistoryOpenFor(null);
                          toast.success(
                            '이전 값으로 되돌렸습니다. 저장을 눌러야 서버에 반영됩니다.',
                          );
                        },
                      }))}
                    />
                  ) : null}
                </div>
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
                  <Field
                    label="전용면적"
                    hint="실거래에 있는 평형만 선택할 수 있고, 바꾸면 호가가 그 평형 실거래 중앙값으로 갱신됩니다"
                  >
                    <AreaTypeSelect
                      lawdCd={t.lawdCd}
                      complexName={t.complexName}
                      value={t.areaM2}
                      onPick={(p) => {
                        updateTarget(t.id, {
                          areaM2: p.areaM2,
                          manualPrice: p.price || undefined,
                          builtYear: p.builtYear ?? t.builtYear,
                          dong: p.dong ?? t.dong,
                        });
                        toast.success(
                          `${t.complexName} ${formatArea(p.areaM2)} — 호가를 실거래 중앙값 ${formatKrw(p.price)}으로 갱신했습니다 (표본 ${p.tradeCount}건, 최근 ${p.latestDealDate}). 저장을 눌러야 반영됩니다.`,
                        );
                      }}
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
                  <Field label="총 세대수" hint="선택 — 갈아타기·시뮬레이션 카드에 표기">
                    <Input
                      type="number"
                      value={t.totalHouseholds ?? ''}
                      className="tabular"
                      onChange={(e) =>
                        updateTarget(t.id, { totalHouseholds: Number(e.target.value) || undefined })
                      }
                    />
                  </Field>
                  <Field label="용적률 (%)" hint="선택 — 재건축 사업성 참고">
                    <Input
                      type="number"
                      step="0.1"
                      value={t.floorAreaRatio ?? ''}
                      className="tabular"
                      onChange={(e) =>
                        updateTarget(t.id, { floorAreaRatio: Number(e.target.value) || undefined })
                      }
                    />
                  </Field>
                  <Field label="대지지분 (㎡)" hint="선택 — 등기부 대지권 면적 기준 권장">
                    <Input
                      type="number"
                      step="0.01"
                      value={t.landShareM2 ?? ''}
                      className="tabular"
                      onChange={(e) =>
                        updateTarget(t.id, { landShareM2: Number(e.target.value) || undefined })
                      }
                    />
                  </Field>
                  <Field
                    label="재건축 단계"
                    hint={
                      t.redevelopmentSource ?? '선택 — 서울 단지는 정비몽땅에서 자동으로 채웁니다'
                    }
                  >
                    <Input
                      list="redevelopment-stages"
                      value={t.redevelopmentStage ?? ''}
                      placeholder="예: 조합설립인가"
                      onChange={(e) =>
                        updateTarget(t.id, {
                          redevelopmentStage: e.target.value || undefined,
                          redevelopmentSource: e.target.value ? '직접 입력' : undefined,
                        })
                      }
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
        title="개인 OpenAI API 키"
        description={
          <>
            등록하면{' '}
            <strong className="text-primary font-semibold">AI 요약 재생성·매물 평가·상담</strong>을
            자기 비용으로 쓸 수 있습니다. 키는 서버에서만 사용되며 요청당 약 5원입니다.
          </>
        }
      >
        <div className="flex max-w-xl items-center gap-2">
          <Input
            type="password"
            autoComplete="off"
            placeholder="sk-..."
            value={config.openaiApiKey ?? ''}
            onChange={(e) => patch({ openaiApiKey: e.target.value || undefined })}
          />
        </div>
        <p className="text-muted-foreground mt-2 text-xs">
          발급: platform.openai.com/api-keys · 저장 버튼을 눌러야 반영됩니다. 비우고 저장하면
          해제됩니다.
        </p>
      </SectionCard>

      <SectionCard
        title={
          <>
            <MessageCircle className="size-4" /> 카카오톡 브리핑
          </>
        }
        description="카카오 '나에게 보내기' 메모 API 를 사용합니다. 사업자 등록이나 알림톡 심사가 필요 없습니다."
        badge={
          recipients.length > 0 ? (
            <Badge variant="secondary">
              수신자 {recipients.filter((r) => r.enabled).length}/{recipients.length}명
            </Badge>
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
            <Alert>
              <AlertTitle>여러 명에게 보내려면</AlertTitle>
              <AlertDescription className="text-[11px] leading-relaxed">
                카카오는 <strong>카카오톡 ID로 남에게 보내는 API를 제공하지 않습니다</strong> (스팸
                방지). 대신 받을 사람이 각자 이 화면에서 자기 카카오 계정으로 한 번만 연결하면, 앱이
                각자의 계정으로 각자에게 &ldquo;나에게 보내기&rdquo;를 실행합니다. 사업자등록·검수가
                필요 없는 유일한 방법입니다.
              </AlertDescription>
            </Alert>

            {/* 수신자 목록 */}
            {recipients.length > 0 ? (
              <div className="space-y-2">
                {recipients.map((r) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-3"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{r.label}</span>
                        {r.expired ? (
                          <Badge variant="outline" className="text-[10px]">
                            토큰 만료 (전송 시 자동 갱신)
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-muted-foreground text-[11px]">
                        {r.nickname ? `카카오 ${r.nickname} · ` : ''}
                        만료 {new Date(r.expiresAt).toLocaleString('ko-KR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={r.enabled}
                        onCheckedChange={(v) => toggleRecipient(r.id, v)}
                        aria-label={`${r.label} 수신 여부`}
                      />
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => disconnect(r.id)}
                        aria-label={`${r.label} 연결 해제`}
                      >
                        <Unplug className="size-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted-foreground text-sm">아직 연결된 카카오 계정이 없습니다.</p>
            )}

            {/* 수신자 추가 */}
            <div className="flex flex-wrap items-end gap-2">
              <Field label="수신자 별명" hint="예: 나, 아내, 부모님" className="w-40">
                <Input
                  value={newRecipientLabel}
                  placeholder="나"
                  onChange={(e) => setNewRecipientLabel(e.target.value)}
                />
              </Field>
              <Button
                size="sm"
                render={
                  <a
                    href={`/api/kakao/connect${newRecipientLabel.trim() ? `?label=${encodeURIComponent(newRecipientLabel.trim())}` : ''}`}
                  />
                }
                nativeButton={false}
              >
                <Plus className="size-4" /> 카카오 계정 연결
              </Button>
              {recipients.length > 0 ? (
                <Button size="sm" variant="outline" onClick={sendTest} disabled={sending}>
                  {sending ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    <Send className="size-4" />
                  )}
                  지금 전원에게 보내기
                </Button>
              ) : null}
            </div>

            <p className="text-muted-foreground text-[11px]">
              다른 사람을 추가할 때는 카카오 로그인 화면에서 <strong>그 사람의 카카오 계정</strong>
              으로 로그인해야 합니다. 이미 로그인돼 있으면 로그아웃 후 진행하세요.
            </p>

            <ToggleRow
              label="카카오로 일일 브리핑 발송"
              hint="하루 1번, 아래 시각에 '내 갈아타기' 요약만 보냅니다. 시장 전반 브리핑 전문은 텔레그램이 담당합니다"
              checked={config.kakaoBriefingEnabled}
              onChange={(v) => patch({ kakaoBriefingEnabled: v })}
            />

            <Field
              label="발송 시각 (KST)"
              hint="이 시각 이후 첫 실행에서 발송됩니다 (기본 08시). 스케줄러가 밀려도 놓친 발송은 자동으로 따라잡습니다"
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

      {/* 텔레그램 브리핑 */}
      <SectionCard
        title={
          <>
            <Send className="size-4" /> 텔레그램 브리핑
          </>
        }
        description="봇을 그룹에 초대하면 가족과 함께 받을 수 있습니다. 카카오와 별개로 켜고 끕니다."
        badge={
          config.telegramEnabled && config.telegramChatId ? (
            <Badge variant="secondary">연결됨</Badge>
          ) : (
            <Badge variant="outline">미연결</Badge>
          )
        }
      >
        {!flags.telegram ? (
          <Alert>
            <AlertTitle>TELEGRAM_BOT_TOKEN 미설정</AlertTitle>
            <AlertDescription className="text-[11px] leading-relaxed">
              텔레그램에서 <strong>@BotFather</strong> 에게 <code>/newbot</code> 을 보내 봇을 만들면
              토큰이 발급됩니다. 그 토큰을 Vercel 환경변수 <code>TELEGRAM_BOT_TOKEN</code> 에 추가한
              뒤 이 화면을 새로고침하세요. 무료이고 검수·사업자 등록이 필요 없습니다.
            </AlertDescription>
          </Alert>
        ) : (
          <div className="space-y-4">
            <Alert>
              <AlertTitle>연결 방법</AlertTitle>
              <AlertDescription className="text-[11px] leading-relaxed">
                ① 브리핑을 받을 <strong>그룹 방에 봇을 초대</strong>하거나(가족 공유), 봇과{' '}
                <strong>1:1 대화를 시작</strong>하세요
                {tgBot.username ? ` (@${tgBot.username})` : ''}. ② 그 방에서 아무 메시지나 한 번
                보내세요. ③ 아래 [대화 감지]를 누르면 방이 나타납니다 — 선택 후{' '}
                <strong>저장</strong>하면 완료.
              </AlertDescription>
            </Alert>

            <div className="flex flex-wrap items-end gap-2">
              <Field label="chat_id" hint="대화 감지로 자동 입력됩니다" className="w-52">
                <Input
                  value={config.telegramChatId ?? ''}
                  placeholder="-100123456789"
                  className="tabular"
                  onChange={(e) => patch({ telegramChatId: e.target.value.trim() || undefined })}
                />
              </Field>
              <Button size="sm" variant="outline" onClick={detectTelegram} disabled={tgDetecting}>
                {tgDetecting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Plus className="size-4" />
                )}
                대화 감지
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={testTelegram}
                disabled={tgTesting || !config.telegramChatId}
              >
                {tgTesting ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <Send className="size-4" />
                )}
                테스트 발송
              </Button>
            </div>

            {tgChats.length > 0 ? (
              <div className="space-y-1.5">
                <p className="text-muted-foreground text-[11px]">
                  감지된 대화 — 클릭하면 chat_id 가 입력됩니다. 저장을 눌러야 반영됩니다.
                </p>
                {tgChats.map((c) => (
                  <button
                    key={c.chatId}
                    type="button"
                    onClick={() => patch({ telegramChatId: c.chatId })}
                    className={cn(
                      'hover:bg-muted/50 flex w-full items-center justify-between rounded-lg border p-2.5 text-left text-sm transition-colors',
                      config.telegramChatId === c.chatId && 'border-foreground/40 bg-muted/60',
                    )}
                  >
                    <span>
                      {c.title}{' '}
                      <span className="text-muted-foreground text-[11px]">
                        (
                        {c.type === 'private' ? '1:1 대화' : c.type === 'channel' ? '채널' : '그룹'}
                        )
                      </span>
                    </span>
                    <span className="tabular text-muted-foreground text-xs">{c.chatId}</span>
                  </button>
                ))}
              </div>
            ) : null}

            <ToggleRow
              label="텔레그램으로 일일 브리핑 발송"
              hint="카카오와 같은 내용·같은 시각에 발송됩니다"
              checked={config.telegramEnabled}
              onChange={(v) => patch({ telegramEnabled: v })}
            />
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
            quota="일 10,000건 (개발계정) · 매일 자정(KST) 초기화"
            usedToday={apiUsage?.molit}
          />
          <KeyRow
            ok={flags.ecos}
            label="한국은행 ECOS"
            env="ECOS_API_KEY"
            url="https://ecos.bok.or.kr/api/#/AuthKeyApply"
            quota="일 10,000건 · 매일 자정 초기화"
            usedToday={apiUsage?.ecos}
          />
          <KeyRow
            ok={flags.reb}
            label="한국부동산원 R-ONE"
            env="REB_API_KEY"
            url="https://www.reb.or.kr/r-one/portal/openapi/openApiIntro.do"
            quota="일일 트래픽 제한 — R-ONE 마이페이지에서 확인"
            usedToday={apiUsage?.reb}
          />
          <KeyRow
            ok={flags.naver}
            label="네이버 뉴스 검색"
            env="NAVER_CLIENT_ID / SECRET"
            url="https://developers.naver.com/apps/#/register"
            quota="일 25,000건 · 매일 자정 초기화 (초과 시 HTTP 429)"
            usedToday={apiUsage?.naver}
          />
          <KeyRow
            ok={flags.kakao}
            label="카카오 메시지"
            env="KAKAO_REST_API_KEY"
            url="https://developers.kakao.com"
            quota="쿼터는 개발자센터 앱 대시보드에서 확인"
            usedToday={apiUsage?.kakao}
          />
          <KeyRow
            ok={flags.telegram}
            label="텔레그램 봇"
            env="TELEGRAM_BOT_TOKEN"
            url="https://t.me/BotFather"
            quota="무료 — 초당 30건 제한"
            usedToday={apiUsage?.telegram}
          />
          <KeyRow
            ok={flags.supabase}
            label="Supabase (설정·캐시 저장)"
            env="SUPABASE_SERVICE_ROLE_KEY"
            url="https://supabase.com/dashboard"
            quota="무료 플랜 500MB·월 5GB 전송 — 대시보드 Usage 에서 확인"
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
            보유 {config.holdings.length} · 목표 {config.targets.filter(isTargetEnabled).length}
            {config.targets.some((t) => !isTargetEnabled(t))
              ? ` (꺼짐 ${config.targets.filter((t) => !isTargetEnabled(t)).length})`
              : ''}{' '}
            · 관심지역 {config.watchRegions.length}
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

/**
 * 카드의 이전 저장본 목록.
 * 설정을 잘못 입력하고 저장했을 때, 전체가 아니라 이 아파트만 시점 단위로 되돌린다.
 * 복원은 편집 상태에만 반영되며 저장을 눌러야 서버에 저장된다.
 */
function HistoryList({
  rows,
}: {
  rows: Array<{ savedAt: string; summary: string; restore: () => void }>;
}) {
  if (rows.length === 0) {
    return (
      <p className="text-muted-foreground rounded-md border border-dashed p-2.5 text-[11px]">
        이 아파트의 이전 저장본이 없습니다. 저장할 때마다 직전 값이 여기에 남습니다 (최근 10회).
      </p>
    );
  }
  return (
    <ul className="space-y-1 rounded-md border p-2">
      {rows.map((r, i) => (
        <li
          key={i}
          className="flex flex-wrap items-center justify-between gap-2 rounded px-1.5 py-1 text-[11px]"
        >
          <span>
            <span className="text-foreground font-medium">
              {new Date(r.savedAt).toLocaleString('ko-KR', {
                month: 'numeric',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}{' '}
              저장본
            </span>{' '}
            <span className="text-muted-foreground">— {r.summary}</span>
          </span>
          <Button type="button" size="sm" variant="outline" onClick={r.restore}>
            이 값으로 복원
          </Button>
        </li>
      ))}
    </ul>
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

function KeyRow({
  ok,
  label,
  env,
  url,
  quota,
  usedToday,
}: {
  ok: boolean;
  label: string;
  env: string;
  url: string;
  /** 일일 쿼터·초기화 안내 — API 가 "남은 횟수"를 응답에 주지 않아 문서 기준 한도를 표기한다 */
  quota?: string;
  /** 오늘 우리가 보낸 호출 수 (자체 집계 근사치, 캐시 응답 포함) */
  usedToday?: number;
}) {
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
        {quota ? (
          <p className="text-muted-foreground mt-0.5 text-[11px]">
            {quota}
            {usedToday !== undefined
              ? ` · 오늘 ${usedToday.toLocaleString('ko-KR')}건 사용 (캐시 포함 근사치)`
              : ''}
          </p>
        ) : null}
      </div>
      <Badge variant={ok ? 'secondary' : 'outline'}>{ok ? '설정됨' : '없음'}</Badge>
    </a>
  );
}
