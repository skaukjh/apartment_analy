/**
 * 행정동 ↔ 법정동 이름 맞추기
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────
 * 지도 경계(통계청)는 **행정동**이고, 국토교통부 실거래는 **법정동**이다.
 * 지도에서 "자양2동"을 눌러도 실거래에는 "자양동"밖에 없어서
 * 아무것도 안 나온다. 실제로 광진구 자양2동에서 단지 0개가 나왔다.
 *
 * 행정동은 법정동 하나를 인구 기준으로 쪼갠 것이라 대개 이름 앞부분이 같다.
 *  자양1동 · 자양2동 · 자양3동 · 자양4동  →  자양동
 *  상계제1동                              →  상계동
 *  종로1·2·3·4가동                        →  종로동 (앞부분만)
 *
 * 그래서 숫자와 '제'를 떼어 기준 이름을 만들고, 그걸로 비교한다.
 * 이름 규칙이 다른 소수 사례(예: 서울 중구 소공동↔북창동)는 이 방법으로 못 잡는다.
 * 그런 경우 호출부에서 동 필터 없이 시군구 전체를 보여주는 편이 낫다.
 */

/**
 * 동 이름에서 행정동 분할 번호를 떼어낸 기준 이름.
 *
 *  '자양2동'      → '자양동'
 *  '상계제1동'    → '상계동'
 *  '종로1·2·3가동' → '종로동'
 *  '가락본동'     → '가락동'
 *  '역삼동'       → '역삼동' (변화 없음)
 */
export function baseDongName(name: string): string {
  let s = name.trim();
  if (!s) return s;

  // 끝의 '동'을 잠시 떼고 몸통만 다듬는다
  const hasDongSuffix = s.endsWith('동');
  if (hasDongSuffix) s = s.slice(0, -1);

  // '제1', '1', '1·2·3가' 같은 분할 표시 제거
  s = s.replace(/제?\s*[0-9]+(\s*[·.,]\s*[0-9]+)*\s*(가|街)?$/u, '');

  // '가락본동' 처럼 본동/중앙동 표기도 기준 이름으로 되돌린다
  s = s.replace(/(본|중앙)$/u, '');

  s = s.trim();
  return s ? `${s}동` : name.trim();
}

/**
 * 실거래의 동 이름이 사용자가 고른 동에 해당하는지.
 * 정확히 같거나, 행정동 번호만 다른 경우 같은 것으로 본다.
 */
export function dongMatches(tradeDong: string, selected: string): boolean {
  if (!selected) return true;
  if (!tradeDong) return false;
  if (tradeDong === selected) return true;
  return baseDongName(tradeDong) === baseDongName(selected);
}
