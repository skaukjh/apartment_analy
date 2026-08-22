/**
 * 관심 지역 호재 추적 (요구사항 4)
 *
 * 설계 원칙: 호재의 "진행 단계"는 시간이 지나면 반드시 낡는다.
 * 따라서 코드에는 변하지 않는 것(사업명·성격·관련 지역 키워드·공식 출처)만 두고,
 * 단계·진행률은 최신 뉴스 헤드라인에서 실시간으로 추론한다.
 * 뉴스가 없으면 '미확인'으로 표시하고 공식 출처 링크를 제공한다.
 */

import type { CatalystStatus, NewsItem, UserConfig, WatchRegion } from '@/lib/types';

/** 사업 단계와 진행률 매핑 */
const STAGE_ORDER: Array<{ stage: CatalystStatus['stage']; progress: number; patterns: RegExp }> = [
  { stage: '준공/개통', progress: 100, patterns: /(개통|준공|입주 시작|완공|운행 개시|영업 개시)/ },
  { stage: '공사중', progress: 70, patterns: /(공사 중|공정률|터널 관통|상량|골조)/ },
  { stage: '착공', progress: 55, patterns: /(착공|첫 삽|기공식|공사 시작|사업시행 인가)/ },
  { stage: '설계', progress: 40, patterns: /(실시설계|기본설계|턴키|시공사 선정|우선협상대상자)/ },
  {
    stage: '예타',
    progress: 25,
    patterns: /(예비타당성|예타 통과|예타 면제|타당성 조사|기재부 심의)/,
  },
  {
    stage: '계획수립',
    progress: 15,
    patterns: /(기본계획|고시|지구지정|정비구역 지정|조합 설립|안전진단 통과|계획 확정)/,
  },
  { stage: '구상', progress: 5, patterns: /(검토|추진 논의|건의|구상|요구|제안)/ },
];

/**
 * 수도권 주요 호재 시드.
 * 여기에는 시간이 지나도 변하지 않는 정보만 담는다 (사업명·성격·검색 키워드·공식 출처).
 * 진행 단계는 항상 뉴스에서 재추론한다.
 */
export interface CatalystSeed {
  id: string;
  title: string;
  category: CatalystStatus['category'];
  /** 뉴스 검색 및 매칭에 사용할 키워드 */
  keywords: string[];
  /** 영향 시군구 법정동코드. '*' 하나만 넣으면 모든 관심 지역에 해당(전국 규제 등) */
  affects: string[];
  impact: CatalystStatus['impact'];
  sourceUrl: string;
  /** 악재 여부. 생략하면 호재 */
  polarity?: 'negative';
}

export const CATALYST_SEEDS: CatalystSeed[] = [
  {
    id: 'gtx-a',
    title: 'GTX-A (운정~동탄)',
    category: 'transport',
    keywords: ['GTX-A', 'GTX A노선'],
    affects: ['41480', '41287', '41285', '11650', '11680', '41590', '41117'],
    impact: 'high',
    sourceUrl: 'https://www.molit.go.kr',
  },
  {
    id: 'gtx-b',
    title: 'GTX-B (인천대입구~마석)',
    category: 'transport',
    keywords: ['GTX-B', 'GTX B노선'],
    affects: ['28185', '28177', '41190', '11560', '11170', '11230', '41360'],
    impact: 'high',
    sourceUrl: 'https://www.molit.go.kr',
  },
  {
    id: 'gtx-c',
    title: 'GTX-C (덕정~수원)',
    category: 'transport',
    keywords: ['GTX-C', 'GTX C노선'],
    affects: ['41630', '41150', '11350', '11230', '11650', '41290', '41173', '41117'],
    impact: 'high',
    sourceUrl: 'https://www.molit.go.kr',
  },
  {
    id: 'sinansan',
    title: '신안산선 (안산·시흥~여의도)',
    category: 'transport',
    keywords: ['신안산선'],
    affects: ['41271', '41273', '41390', '41210', '11530', '11560'],
    impact: 'high',
    sourceUrl: 'https://www.molit.go.kr',
  },
  {
    id: 'wolgot-pangyo',
    title: '월곶~판교 복선전철',
    category: 'transport',
    keywords: ['월곶판교선', '월곶~판교'],
    affects: ['41390', '41173', '41430', '41135'],
    impact: 'medium',
    sourceUrl: 'https://www.molit.go.kr',
  },
  {
    id: 'wirye-sinsa',
    title: '위례신사선',
    category: 'transport',
    keywords: ['위례신사선'],
    affects: ['11710', '11650', '11680'],
    impact: 'medium',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: 'seobu-line',
    title: '서부선 경전철',
    category: 'transport',
    keywords: ['서부선'],
    affects: ['11380', '11410', '11440', '11560', '11590', '11620'],
    impact: 'medium',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: 'yongsan-idz',
    title: '용산국제업무지구',
    category: 'development',
    keywords: ['용산국제업무지구', '용산정비창'],
    affects: ['11170'],
    impact: 'high',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: 'yeouido-redev',
    title: '여의도 아파트지구 재건축',
    category: 'development',
    keywords: ['여의도 재건축', '여의도 시범아파트'],
    affects: ['11560'],
    impact: 'high',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: 'apgujeong-redev',
    title: '압구정 재건축 (1~6구역)',
    category: 'development',
    keywords: ['압구정 재건축', '압구정 신속통합기획'],
    affects: ['11680'],
    impact: 'high',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: 'mokdong-redev',
    title: '목동 신시가지 재건축',
    category: 'development',
    keywords: ['목동 재건축', '목동 신시가지'],
    affects: ['11470'],
    impact: 'high',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: 'noeun-redev',
    title: '노원·상계 재건축',
    category: 'development',
    keywords: ['상계주공 재건축', '노원 재건축'],
    affects: ['11350', '11320'],
    impact: 'medium',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: '1st-newtown-redev',
    title: '1기 신도시 특별법 선도지구 (분당·일산·평촌·산본·중동)',
    category: 'development',
    keywords: ['1기 신도시 선도지구', '노후계획도시 특별법'],
    affects: ['41135', '41285', '41287', '41173', '41410', '41190'],
    impact: 'high',
    sourceUrl: 'https://www.molit.go.kr',
  },
  {
    id: '3rd-newtown',
    title: '3기 신도시 (남양주왕숙·하남교산·고양창릉·부천대장·인천계양)',
    category: 'supply',
    keywords: ['3기 신도시', '왕숙', '교산', '창릉', '대장지구'],
    affects: ['41360', '41450', '41281', '41190', '28245'],
    impact: 'high',
    sourceUrl: 'https://www.lh.or.kr',
  },
  {
    id: 'sejong-relocation',
    title: '세종 행정수도 기능 이전',
    category: 'policy',
    keywords: ['세종 행정수도', '국회 세종의사당'],
    affects: ['36110'],
    impact: 'high',
    sourceUrl: 'https://www.sejong.go.kr',
  },

  /* ── 악재 — 가격에 부담을 주는 규제·정책. affects '*' 는 모든 관심 지역 노출 ── */
  {
    id: 'land-permit-zone',
    title: '토지거래허가구역 (강남3구·용산 등)',
    category: 'policy',
    polarity: 'negative',
    keywords: ['토지거래허가'],
    affects: ['11680', '11650', '11710', '11170'],
    impact: 'high',
    sourceUrl: 'https://news.seoul.go.kr',
  },
  {
    id: 'recon-levy',
    title: '재건축초과이익환수제 (재초환)',
    category: 'policy',
    polarity: 'negative',
    keywords: ['재건축초과이익', '재초환'],
    affects: ['11350', '11320', '11470', '11680', '11650', '11710', '11560'],
    impact: 'medium',
    sourceUrl: 'https://www.molit.go.kr',
  },
  {
    id: 'loan-regulation',
    title: '대출 규제 (스트레스 DSR·주담대 한도)',
    category: 'policy',
    polarity: 'negative',
    keywords: ['스트레스 DSR', '주담대 한도', '대출 규제'],
    affects: ['*'],
    impact: 'high',
    sourceUrl: 'https://www.fsc.go.kr',
  },
];

/**
 * 호재·악재를 추적할 지역 = 관심 지역 ∪ 보유 아파트 지역 ∪ 목표 아파트 지역.
 * 보유·목표는 단지 단위라 시군구로 승격해 합친다 (lawdCd 기준 중복 제거).
 * "왜 내 보유 지역 호재가 안 보이지?"를 없애기 위한 규칙이다.
 */
export function catalystCoverageRegions(
  config: Pick<UserConfig, 'watchRegions' | 'holdings' | 'targets'>,
): WatchRegion[] {
  const byCode = new Map<string, WatchRegion>();
  for (const r of config.watchRegions) byCode.set(r.lawdCd, r);
  for (const a of [...config.holdings, ...config.targets]) {
    if (!a.lawdCd || byCode.has(a.lawdCd)) continue;
    byCode.set(a.lawdCd, {
      id: `asset-${a.lawdCd}`,
      name: `${a.sido} ${a.sigungu}`.trim(),
      sido: a.sido,
      sigungu: a.sigungu,
      lawdCd: a.lawdCd,
      keywords: [],
    });
  }
  return [...byCode.values()];
}

/** 뉴스 텍스트에서 진행 단계를 추론 */
export function inferStage(
  texts: string[],
): { stage: CatalystStatus['stage']; progress: number } | null {
  const joined = texts.join(' ');
  for (const s of STAGE_ORDER) {
    if (s.patterns.test(joined)) return { stage: s.stage, progress: s.progress };
  }
  return null;
}

/** 뉴스가 특정 호재에 해당하는지 */
function matchesCatalyst(news: NewsItem, seed: CatalystSeed): boolean {
  const text = `${news.title} ${news.summary}`.replace(/\s+/g, '');
  return seed.keywords.some((k) => text.includes(k.replace(/\s+/g, '')));
}

export interface BuildCatalystOptions {
  regions: WatchRegion[];
  news: NewsItem[];
  /** 사용자가 직접 등록한 호재 */
  userCatalysts?: CatalystStatus[];
}

/**
 * 관심 지역과 관련된 호재 목록을 만든다.
 * 시드 중 관심 지역에 걸리는 것만 노출하고, 최신 뉴스로 단계를 갱신한다.
 */
export function buildCatalysts(options: BuildCatalystOptions): CatalystStatus[] {
  const { regions, news, userCatalysts = [] } = options;
  const regionCodes = new Set(regions.map((r) => r.lawdCd));
  const results: CatalystStatus[] = [];

  for (const seed of CATALYST_SEEDS) {
    const nationwide = seed.affects.includes('*');
    const hitCodes = nationwide
      ? regions.map((r) => r.lawdCd)
      : seed.affects.filter((c) => regionCodes.has(c));
    if (hitCodes.length === 0) continue;

    const related = news
      .filter((n) => matchesCatalyst(n, seed))
      .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

    /* 지역이 실제로 언급된 기사를 우선한다.
       "대출 규제" 같은 전국 이슈에 전국 일반론 기사만 줄줄이 붙어
       "내 지역 악재"로서는 도움이 안 된다는 피드백이 있었다 —
       지역 언급 기사가 있으면 그것만 쓰고, 없을 때만 일반 보도로 넓힌다. */
    const matchedRegionList = regions.filter((r) => hitCodes.includes(r.lawdCd));
    const shortNames = matchedRegionList
      .map((r) => (r.sigungu || r.name).replace(/(특별시|광역시|특별자치시|시|군|구)$/, ''))
      .filter((s) => s.length >= 2);
    const regional = related.filter((n) => {
      const text = `${n.title} ${n.summary}`;
      return shortNames.some((name) => text.includes(name));
    });
    const chosen = regional.length > 0 ? regional : related;

    const inferred = inferStage(chosen.slice(0, 8).map((n) => `${n.title} ${n.summary}`));
    const region = regions.find((r) => hitCodes.includes(r.lawdCd));

    // 출처 링크 — 공식 출처 1 + 최신 관련 뉴스로 채워 최대 5개 (URL 중복 제거)
    const sourceLinks: Array<{ title: string; url: string }> = [
      { title: '공식 출처', url: seed.sourceUrl },
    ];
    for (const n of chosen) {
      if (sourceLinks.length >= 5) break;
      if (sourceLinks.some((l) => l.url === n.url)) continue;
      sourceLinks.push({ title: n.title, url: n.url });
    }

    results.push({
      id: seed.id,
      regionId: region?.id ?? hitCodes[0],
      title: seed.title,
      category: seed.category,
      stage: inferred?.stage ?? '계획수립',
      progress: inferred?.progress ?? 0,
      lastUpdate: chosen[0]?.publishedAt ?? '미확인',
      impact: seed.impact,
      sourceUrl: chosen[0]?.url ?? seed.sourceUrl,
      polarity: seed.polarity ?? 'positive',
      matchedRegions: matchedRegionList.map((r) => r.name),
      sourceLinks,
      scope: nationwide ? 'nationwide' : 'region',
      newsScope: regional.length > 0 ? 'region' : 'general',
      expectedAt: undefined,
    });
  }

  // 사용자 등록 호재는 항상 우선 노출
  const seedIds = new Set(results.map((r) => r.id));
  for (const uc of userCatalysts) {
    if (seedIds.has(uc.id)) {
      const idx = results.findIndex((r) => r.id === uc.id);
      results[idx] = { ...results[idx], ...uc };
    } else {
      results.push(uc);
    }
  }

  const impactRank = { high: 0, medium: 1, low: 2 } as const;
  // 지역에 특정된 항목이 전국 공통 규제보다 먼저 온다 — 사용자에게 유의미한 순서
  const scopeRank = (c: CatalystStatus) => (c.scope === 'nationwide' ? 1 : 0);
  return results.sort(
    (a, b) =>
      scopeRank(a) - scopeRank(b) ||
      impactRank[a.impact] - impactRank[b.impact] ||
      b.progress - a.progress,
  );
}

export const STAGE_LABELS: CatalystStatus['stage'][] = [
  '구상',
  '계획수립',
  '예타',
  '설계',
  '착공',
  '공사중',
  '준공/개통',
];
