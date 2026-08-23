/**
 * 코드에 하드코딩된 정책 규칙의 대장(臺帳).
 *
 * 대출 한도·세율·규제지역 같은 규칙은 기계가 읽을 수 있는 공식 데이터가 없어
 * 코드에 상수로 박을 수밖에 없다. 그래서 대책이 새로 나오면 사람이 갱신해야 하는데,
 * 실제로 10.15 대책의 주담대 차등 한도가 한동안 미반영된 채 계산이 나간 적이 있다.
 *
 * 이 대장은 두 곳에서 쓴다:
 *  1. 정책 다이제스트가 매시간 공식 발표를 훑을 때 — 각 규칙의 키워드에 걸리는
 *     발표가 나오면 "코드 기준이 낡았을 수 있다" 경고를 만든다.
 *  2. 설정 화면(관리자) — 경고 배너에 어떤 규칙이 어느 파일에 있는지 보여줘
 *     반영 작업으로 바로 이어지게 한다.
 *
 * 규칙을 코드에서 갱신하면 여기의 asOf 도 함께 갱신할 것.
 */

import { REGULATION_AS_OF } from '@/lib/analysis/regulation';

export interface PolicyRule {
  key: string;
  label: string;
  /** 코드에 반영된 기준 (대책명·일자) */
  asOf: string;
  /** 코드가 쓰는 규칙 요약 */
  summary: string;
  /** 규칙이 구현된 파일 (관리자 안내용) */
  file: string;
  /** 공식 발표 제목·요약에서 변경 신호를 찾는 패턴 */
  pattern: RegExp;
  /** 기사까지 볼지 (기본 false — 공식 발표만. 기사는 오탐이 많다) */
  includeNews?: boolean;
}

export const POLICY_RULES: PolicyRule[] = [
  {
    key: 'loan-cap',
    label: '주담대 총액 한도',
    asOf: '2025.10.15 대책',
    summary: '규제지역 15억↓ 6억 / 15~25억 4억 / 25억↑ 2억 · 비규제 수도권 6억',
    file: 'src/lib/tax/loan-limit.ts',
    pattern:
      /(주담대|주택담보대출|대출\s?한도)[^.]{0,50}(한도|차등|상향|하향|강화|완화|개편|폐지|신설)/,
  },
  {
    key: 'ltv-dsr',
    label: 'LTV·DSR',
    asOf: '2025.10.15 대책',
    summary: '규제 50%(생애최초 80%) / 비규제 70% · DSR 40% + 스트레스 +1.5%p',
    file: 'src/lib/tax/loan-limit.ts',
    pattern: /(LTV|DSR|스트레스\s?DSR)[^.]{0,50}(조정|상향|하향|강화|완화|개편|확대|시행)/,
  },
  {
    key: 'regulated-zones',
    label: '규제지역 지정',
    asOf: REGULATION_AS_OF,
    summary: '서울 전역 + 경기 15곳 — 조정대상·투기과열·토허구역 동시 지정',
    file: 'src/lib/analysis/regulation.ts',
    pattern: /(조정대상지역|투기과열지구|토지거래허가)[^.]{0,40}(지정|해제|확대|축소|추가)/,
    includeNews: true, // 지역 지정·해제는 세금 판정에 직결 — 기사 신호도 놓치지 않는다
  },
  {
    key: 'acquisition-tax',
    label: '취득세',
    asOf: '2025년 세법 기준',
    summary: '1주택 1~3% · 조정 2주택 8% / 3주택 12% · 85㎡↓ 농특세 면제',
    file: 'src/lib/tax/acquisition.ts',
    pattern: /(취득세)[^.]{0,40}(개편|인하|인상|감면|중과|완화|강화)/,
  },
  {
    key: 'capital-gains',
    label: '양도소득세',
    asOf: '2025년 세법 기준',
    summary: '1주택 12억 비과세 · 단기 1년↓ 70% / 2년↓ 60% · 다주택 중과 한시 배제',
    file: 'src/lib/tax/capital-gains.ts',
    pattern: /(양도세|양도소득세)[^.]{0,40}(개편|인하|인상|비과세|중과|완화|강화)/,
  },
];
