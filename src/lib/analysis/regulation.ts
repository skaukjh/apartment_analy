/**
 * 부동산 규제지역 현황.
 *
 * ⚠️ 정부가 수시로 지정·해제하므로 이 파일의 값은 "기본 가정"이다.
 *    각 지정 현황은 국토교통부 공고로 확인해야 하고, 설정 화면에서 직접 덮어쓸 수 있다.
 *    마지막 반영 시점을 REGULATION_AS_OF 에 적어 화면에 노출한다.
 *
 * 세 가지 지정이 각각 다른 효과를 낸다:
 *  - 조정대상지역: LTV 축소, 취득세 중과, 양도세 중과(한시 배제 중), 분양권 전매 제한
 *  - 투기과열지구: 조정대상지역 규제 + 재건축 조합원 지위 양도 제한, 15억 초과 대출 제한 이력
 *  - 토지거래허가구역: 실거주 목적만 매수 가능 (2년 실거주 의무), 갭투자 불가
 */

export const REGULATION_AS_OF = '10·15 대책(2025) 반영, 2026-08 확인';

export type RegulationKind = 'adjusted' | 'speculation' | 'land-permit';

/**
 * 10·15 부동산 대책 (2025-10-15 발표) 기준:
 *  - 조정대상지역·투기과열지구: 서울 전 지역 + 경기 12곳 (2025-10-16 발효)
 *  - 토지거래허가구역: 서울 전 지역 + 경기 12곳의 아파트 (2025-10-20 발효)
 *
 * 이전에는 강남3구·용산만 들어 있어 광진구가 "비규제"로 표시되던 오류가 있었다.
 */
const GYEONGGI_12 = new Set<string>([
  '41290', // 과천시
  '41210', // 광명시
  '41135', // 성남 분당구
  '41131', // 성남 수정구
  '41133', // 성남 중원구
  '41117', // 수원 영통구
  '41111', // 수원 장안구
  '41115', // 수원 팔달구
  '41173', // 안양 동안구
  '41465', // 용인 수지구
  '41430', // 의왕시
  '41450', // 하남시
]);

/** 서울 시군구 여부 (법정동코드 11로 시작) */
function isSeoulGu(lawdCd: string): boolean {
  return /^11\d{3}$/.test(lawdCd);
}

/** 조정대상지역 여부 — 서울 전역 + 경기 12곳 */
function isAdjusted(lawdCd: string): boolean {
  return isSeoulGu(lawdCd) || GYEONGGI_12.has(lawdCd);
}

/** 하위 호환 — Set 을 직접 참조하던 코드용. 서울 25개 구 + 경기 12곳 */
export const ADJUSTED_AREAS = new Set<string>([
  ...[
    '11110',
    '11140',
    '11170',
    '11200',
    '11215',
    '11230',
    '11260',
    '11290',
    '11305',
    '11320',
    '11350',
    '11380',
    '11410',
    '11440',
    '11470',
    '11500',
    '11530',
    '11545',
    '11560',
    '11590',
    '11620',
    '11650',
    '11680',
    '11710',
    '11740',
  ],
  ...GYEONGGI_12,
]);

/** 투기과열지구 — 10·15 대책으로 조정대상지역과 동일 범위 */
export const SPECULATION_AREAS = ADJUSTED_AREAS;

/** 토지거래허가구역 — 아파트 대상, 조정대상지역과 동일 범위 */
export const LAND_PERMIT_AREAS = ADJUSTED_AREAS;

export interface RegulationStatus {
  lawdCd: string;
  adjusted: boolean;
  speculation: boolean;
  landPermit: boolean;
  /** 수도권 여부 (주담대 총액 한도 대상) */
  metro: boolean;
  /** 화면 표시용 배지 목록 */
  badges: string[];
  /** 규제 효과 설명 */
  effects: string[];
}

/** 수도권(서울·경기·인천) 여부 */
export function isMetro(lawdCd: string): boolean {
  return /^(11|41|28)/.test(lawdCd);
}

export function regulationOf(lawdCd: string): RegulationStatus {
  const adjusted = isAdjusted(lawdCd);
  const speculation = adjusted;
  const landPermit = adjusted;
  const metro = isMetro(lawdCd);

  const badges: string[] = [];
  const effects: string[] = [];

  if (speculation) {
    badges.push('투기과열지구');
    effects.push(
      '재건축 조합원 지위 양도가 제한되고, 정비사업 물건 매수 시 조합원 자격 확인이 필요합니다.',
    );
  }
  if (adjusted) {
    badges.push('조정대상지역');
    effects.push(
      'LTV 50%(생애최초 80%)로 축소되고, 다주택 취득세 중과(2주택 8%·3주택 12%)가 적용됩니다.',
    );
  }
  if (landPermit) {
    badges.push('토지거래허가구역');
    effects.push(
      '⚠️ 구역 내 매수는 실거주 목적만 허가되며 2년 실거주 의무가 붙습니다. 전세를 끼고 사는 갭투자가 불가능하니, 목표 단지가 지정 구역에 포함되는지 반드시 확인하세요.',
    );
  }
  if (badges.length === 0) {
    badges.push('비규제지역');
    effects.push('LTV 70%(생애최초 80%)가 적용되고 취득세 중과·전매 제한이 없습니다.');
  }
  if (metro) {
    effects.push('수도권이라 주택담보대출 총액 한도(6억)가 함께 적용됩니다.');
  }

  return { lawdCd, adjusted, speculation, landPermit, metro, badges, effects };
}

/** 기존 auto-fill 과의 호환 — 조정대상지역 여부 */
export function isRegulatedArea(lawdCd: string): boolean {
  return isAdjusted(lawdCd);
}
