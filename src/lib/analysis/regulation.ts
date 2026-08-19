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

export const REGULATION_AS_OF = '2025년 기준';

export type RegulationKind = 'adjusted' | 'speculation' | 'land-permit';

/** 조정대상지역 (시군구 단위) */
export const ADJUSTED_AREAS = new Set<string>([
  '11650', // 서초구
  '11680', // 강남구
  '11710', // 송파구
  '11170', // 용산구
]);

/** 투기과열지구 (시군구 단위) */
export const SPECULATION_AREAS = new Set<string>(['11650', '11680', '11710', '11170']);

/**
 * 토지거래허가구역 (시군구 단위로 단순화).
 * 실제로는 구 안의 특정 동·단지만 지정되는 경우가 많아, 여기서는 "일부 구역 포함"으로 본다.
 */
export const LAND_PERMIT_AREAS = new Set<string>([
  '11650', // 서초 (일부)
  '11680', // 강남 (일부)
  '11710', // 송파 (일부)
  '11170', // 용산 (일부)
  '11560', // 영등포 여의도 (일부)
  '11470', // 양천 목동 (일부)
  '11200', // 성동 (일부)
]);

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
  const adjusted = ADJUSTED_AREAS.has(lawdCd);
  const speculation = SPECULATION_AREAS.has(lawdCd);
  const landPermit = LAND_PERMIT_AREAS.has(lawdCd);
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
  return ADJUSTED_AREAS.has(lawdCd);
}
