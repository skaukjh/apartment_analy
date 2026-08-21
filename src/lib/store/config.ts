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

export const userConfigSchema = z.object({
  holdings: z.array(holdingSchema).default([]),
  targets: z.array(targetSchema).default([]),
  watchRegions: z.array(watchRegionSchema).default([]),
  household: householdSchema.default(householdSchema.parse({})),
  kakaoBriefingEnabled: z.boolean().default(true),
  briefingHour: z.number().int().min(0).max(23).default(8),
  briefingFormat: z.enum(['summary', 'full', 'image']).default('image'),
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
  briefingHour: 8,
  briefingFormat: 'image',
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

export async function saveConfig(input: unknown, userId: string = CONFIG_ID): Promise<UserConfig> {
  const parsed = userConfigSchema.parse(input);
  const config: UserConfig = { ...parsed, updatedAt: new Date().toISOString() } as UserConfig;

  const client = getAdminClient();
  if (!client) {
    memoryState().config = config;
    return config;
  }

  const { error } = await client
    .from('user_config')
    .upsert({ id: userId, data: config, updated_at: config.updatedAt });

  if (error) throw new Error(`설정 저장 실패: ${error.message}`);
  memoryState().config = config;
  return config;
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
