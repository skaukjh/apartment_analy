/**
 * 사용자 설정 저장소.
 * Supabase 가 설정돼 있으면 DB를, 없으면 프로세스 메모리를 사용한다.
 * (메모리 폴백은 로컬 개발 편의용이며 재시작 시 초기화된다.)
 */

import { z } from 'zod';
import type { UserConfig } from '@/lib/types';
import { getAdminClient } from './supabase';
import { memoryState } from './memory';

const CONFIG_ID = 'default';

/* ------------------------------------------------------------------ */
/* 스키마 검증                                                          */
/* ------------------------------------------------------------------ */

const apartmentRefSchema = z.object({
  id: z.string().min(1),
  complexName: z.string().min(1, '단지명을 입력하세요'),
  sido: z.string().default(''),
  sigungu: z.string().default(''),
  dong: z.string().default(''),
  lawdCd: z.string().regex(/^\d{5}$/, '법정동코드 5자리를 선택하세요'),
  areaM2: z.number().positive('전용면적을 입력하세요'),
  floor: z.number().optional(),
  builtYear: z.number().optional(),
  totalHouseholds: z.number().positive().optional(),
  floorAreaRatio: z.number().positive().optional(),
  landShareM2: z.number().positive().optional(),
  redevelopmentStage: z.string().optional(),
  redevelopmentSource: z.string().optional(),
});

export const holdingSchema = apartmentRefSchema.extend({
  kind: z.literal('holding'),
  acquiredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '취득일 형식은 YYYY-MM-DD 입니다'),
  acquisitionPrice: z.number().nonnegative(),
  acquisitionCost: z.number().nonnegative().default(0),
  capitalExpenditure: z.number().nonnegative().default(0),
  residenceMonths: z.number().nonnegative().default(0),
  loanBalance: z.number().nonnegative().default(0),
  loanRate: z.number().nonnegative().default(0),
  leaseDeposit: z.number().nonnegative().default(0),
  manualPrice: z.number().nonnegative().optional(),
});

export const targetSchema = apartmentRefSchema.extend({
  kind: z.literal('target'),
  manualPrice: z.number().nonnegative().optional(),
  priority: z.number().int().min(1).default(1),
  memo: z.string().optional(),
});

export const watchRegionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  sido: z.string().default(''),
  sigungu: z.string().default(''),
  lawdCd: z.string().regex(/^\d{5}$/),
  keywords: z.array(z.string()).default([]),
});

export const householdSchema = z.object({
  ownedHouseCount: z.number().int().min(0).default(1),
  targetIsRegulated: z.boolean().default(false),
  holdingIsRegulated: z.boolean().default(false),
  firstTimeBuyer: z.boolean().default(false),
  temporaryTwoHouse: z.boolean().default(true),
  applyMultiHouseSurcharge: z.boolean().default(false),
  otherCapitalGainThisYear: z.number().nonnegative().default(0),
  cashAssets: z.number().nonnegative().default(0),
  annualIncome: z.number().nonnegative().default(0),
  otherDebtAnnualPayment: z.number().nonnegative().default(0),
});

/**
 * 편집 중(저장 전) 설정용 느슨한 스키마 — 자동 채움 API 가 쓴다.
 *
 * 설정 화면에서 "추가"만 누른 빈 카드는 단지명·면적·지역이 비어 있는데,
 * 저장용 스키마로 검증하면 400 이 나서 "등록 정보로 자동 설정"이 통째로 실패한다.
 * 빈 카드는 계산할 것도 없으므로 통과시키고, 각 계산 함수가 알아서 건너뛴다.
 */
const draftLoose = {
  complexName: z.string().default(''),
  lawdCd: z.string().default(''),
  areaM2: z.number().nonnegative().default(0),
};

export const draftConfigSchema = z.object({
  holdings: z
    .array(holdingSchema.extend({ ...draftLoose, acquiredAt: z.string().default('') }))
    .default([]),
  targets: z.array(targetSchema.extend(draftLoose)).default([]),
  watchRegions: z.array(watchRegionSchema).default([]),
  household: householdSchema.default(householdSchema.parse({})),
  kakaoBriefingEnabled: z.boolean().default(true),
  telegramEnabled: z.boolean().default(false),
  telegramChatId: z.string().trim().max(64).optional(),
  briefingHour: z.number().int().min(0).max(23).default(8),
  briefingFormat: z.enum(['summary', 'full', 'image']).default('summary'),
  openaiApiKey: z.string().trim().max(200).optional(),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

export const userConfigSchema = z.object({
  holdings: z.array(holdingSchema).default([]),
  targets: z.array(targetSchema).default([]),
  watchRegions: z.array(watchRegionSchema).default([]),
  household: householdSchema.default(householdSchema.parse({})),
  kakaoBriefingEnabled: z.boolean().default(true),
  telegramEnabled: z.boolean().default(false),
  telegramChatId: z.string().trim().max(64).optional(),
  briefingHour: z.number().int().min(0).max(23).default(8),
  briefingFormat: z.enum(['summary', 'full', 'image']).default('summary'),
  openaiApiKey: z.string().trim().max(200).optional(),
  updatedAt: z.string().default(() => new Date().toISOString()),
});

/* ------------------------------------------------------------------ */
/* 기본값                                                              */
/* ------------------------------------------------------------------ */

export const DEFAULT_CONFIG: UserConfig = {
  holdings: [],
  targets: [],
  watchRegions: [],
  household: {
    ownedHouseCount: 1,
    targetIsRegulated: false,
    holdingIsRegulated: false,
    firstTimeBuyer: false,
    temporaryTwoHouse: true,
    applyMultiHouseSurcharge: false,
    otherCapitalGainThisYear: 0,
    cashAssets: 0,
    annualIncome: 0,
    otherDebtAnnualPayment: 0,
  },
  kakaoBriefingEnabled: true,
  telegramEnabled: false,
  briefingHour: 8,
  briefingFormat: 'summary',
  updatedAt: new Date(0).toISOString(),
};

/** 설정이 비어 있는지 (온보딩 안내용) */
export function isConfigEmpty(config: UserConfig): boolean {
  return (
    config.holdings.length === 0 && config.targets.length === 0 && config.watchRegions.length === 0
  );
}

/* ------------------------------------------------------------------ */
/* 읽기 / 쓰기                                                          */
/* ------------------------------------------------------------------ */

/**
 * 사용자별 설정 조회.
 *
 * userId 는 반드시 서버에서 세션으로 확인한 값이어야 한다 (lib/auth/server.ts).
 * 로그인하지 않은 요청은 레거시 'default' 를 쓴다 — 다중 사용자 도입 전의
 * 단일 설정이 그 행에 남아 있다.
 */
export async function loadConfig(userId: string = CONFIG_ID): Promise<UserConfig> {
  const client = getAdminClient();
  if (!client) return memoryState().config ?? DEFAULT_CONFIG;

  const { data, error } = await client
    .from('user_config')
    .select('data')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    console.error('[store] 설정 조회 실패:', error.message);
    return memoryState().config ?? DEFAULT_CONFIG;
  }
  if (!data?.data) return DEFAULT_CONFIG;

  const parsed = userConfigSchema.safeParse(data.data);
  if (!parsed.success) {
    console.error('[store] 저장된 설정 형식 오류:', parsed.error.message);
    return DEFAULT_CONFIG;
  }
  return parsed.data as UserConfig;
}

const HISTORY_KIND = 'config-history';
/** 사용자당 보관할 설정 히스토리 수 */
const HISTORY_KEEP = 10;

export async function saveConfig(input: unknown, userId: string = CONFIG_ID): Promise<UserConfig> {
  const parsed = userConfigSchema.parse(input);
  const config: UserConfig = { ...parsed, updatedAt: new Date().toISOString() } as UserConfig;

  const client = getAdminClient();
  if (!client) {
    memoryState().config = config;
    return config;
  }

  /* 덮어쓰기 전에 지금 저장본을 히스토리로 남긴다.
     설정을 잘못 입력하고 저장해 버렸을 때 아파트 카드 단위로
     "이전 내역 불러오기"를 할 수 있게 하기 위함이다. 실패해도 저장은 막지 않는다. */
  await snapshotConfigHistory(userId).catch(() => {});

  const { error } = await client
    .from('user_config')
    .upsert({ id: userId, data: config, updated_at: config.updatedAt });

  if (error) throw new Error(`설정 저장 실패: ${error.message}`);
  memoryState().config = config;
  return config;
}

/** 현재 저장본을 dashboard_snapshot 에 히스토리로 복사하고, 오래된 것은 정리한다 */
async function snapshotConfigHistory(userId: string): Promise<void> {
  const client = getAdminClient();
  if (!client) return;

  const { data } = await client
    .from('user_config')
    .select('data, updated_at')
    .eq('id', userId)
    .maybeSingle();
  if (!data?.data) return; // 첫 저장 — 남길 이전 버전이 없다

  await client.from('dashboard_snapshot').insert({
    captured_at: new Date().toISOString(),
    payload: { kind: HISTORY_KIND, userId, savedAt: data.updated_at, config: data.data },
  });

  // HISTORY_KEEP 개를 넘는 오래된 히스토리는 지운다
  const { data: nth } = await client
    .from('dashboard_snapshot')
    .select('captured_at')
    .eq('payload->>kind', HISTORY_KIND)
    .eq('payload->>userId', userId)
    .order('captured_at', { ascending: false })
    .range(HISTORY_KEEP - 1, HISTORY_KEEP - 1)
    .maybeSingle();
  if (nth?.captured_at) {
    await client
      .from('dashboard_snapshot')
      .delete()
      .lt('captured_at', nth.captured_at as string)
      .eq('payload->>kind', HISTORY_KIND)
      .eq('payload->>userId', userId);
  }
}

/** 설정 히스토리 항목 — 언제 저장했고 어떤 내용이었는지 */
export interface ConfigHistoryEntry {
  savedAt: string;
  config: UserConfig;
}

/** 최근 설정 히스토리 (최신순). 카드 단위 복원 UI 가 쓴다 */
export async function loadConfigHistory(userId: string = CONFIG_ID): Promise<ConfigHistoryEntry[]> {
  const client = getAdminClient();
  if (!client) return [];

  const { data, error } = await client
    .from('dashboard_snapshot')
    .select('payload, captured_at')
    .eq('payload->>kind', HISTORY_KIND)
    .eq('payload->>userId', userId)
    .order('captured_at', { ascending: false })
    .limit(HISTORY_KEEP);
  if (error || !data) return [];

  const out: ConfigHistoryEntry[] = [];
  for (const row of data) {
    const p = row.payload as { savedAt?: string; config?: unknown } | null;
    const parsed = userConfigSchema.safeParse(p?.config);
    if (!parsed.success) continue;
    out.push({
      savedAt: (p?.savedAt as string) ?? (row.captured_at as string),
      config: parsed.data as UserConfig,
    });
  }
  return out;
}

/**
 * 설정이 저장된 모든 사용자 id.
 * 브리핑 cron 이 사용자별로 발송을 돌 때 쓴다. 'default'(레거시) 포함.
 */
export async function listConfigUserIds(): Promise<string[]> {
  const client = getAdminClient();
  if (!client) return [CONFIG_ID];

  const { data, error } = await client.from('user_config').select('id').limit(500);
  if (error || !data) return [CONFIG_ID];
  const ids = data.map((r) => r.id as string);
  return ids.length > 0 ? ids : [CONFIG_ID];
}

/** 설정에서 분석 대상 시군구 코드 목록을 추출 */
export function analysisTargets(config: UserConfig): string[] {
  const codes = new Set<string>();
  config.holdings.forEach((h) => codes.add(h.lawdCd));
  config.targets.forEach((t) => codes.add(t.lawdCd));
  config.watchRegions.forEach((w) => codes.add(w.lawdCd));
  return [...codes];
}
