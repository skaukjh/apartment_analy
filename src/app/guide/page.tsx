import Link from 'next/link';
import {
  Building2,
  Database,
  Landmark,
  LineChart,
  Lock,
  Settings,
  Sparkles,
  TrendingUp,
  UserCheck,
} from 'lucide-react';
import { SectionCard } from '@/components/ui-bits';
import { buttonVariants } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { REFRESH_LABEL } from '@/lib/refresh-policy';

export const metadata = {
  title: '소개 · 사용 가이드 — 이사각',
  description: '이사각이 무엇을 계산해 주는지, 어떤 자료를 쓰는지, 어떻게 시작하는지.',
};

/**
 * 소개 · 사용 가이드.
 *
 * 로그인 없이 볼 수 있는 유일한 "설명" 페이지다. 나머지 화면은 전부 숫자라
 * 처음 온 사람이 무엇을 보고 있는지 알 수 없다는 문제를 여기서 해결한다.
 * 계정 등급별로 무엇이 열리고 잠기는지도 여기에 한 번만 적어 둔다.
 */

/** 메뉴 안내 한 줄 */
const MENUS = [
  {
    href: '/today',
    icon: Sparkles,
    label: '오늘의 요약',
    body: '어제와 무엇이 달라졌는지만 추려서 보여줍니다. 카카오톡·텔레그램으로 가는 브리핑과 같은 내용이고, 이 화면이 그 “전체 보기”입니다.',
    needsConfig: true,
  },
  {
    href: '/',
    icon: Building2,
    label: '내 갈아타기',
    body: '지금 집을 팔고 목표 단지로 옮길 때 “내가 준비할 현금”이 얼마인지가 결론입니다. 실거래가 기준 갭에 취득세·중개보수·양도세·대출한도를 모두 반영합니다.',
    needsConfig: true,
  },
  {
    href: '/simulation',
    icon: LineChart,
    label: '시뮬레이션',
    body: '금리·매도가·매수가를 직접 움직여 보며 결과가 어떻게 바뀌는지 확인합니다. 보유 주택이 없으면 무주택 신규 매수 계산으로 자동 전환됩니다.',
    needsConfig: true,
  },
  {
    href: '/market',
    icon: TrendingUp,
    label: '시장 동향',
    body: '지역별 실거래 지수와 확산 흐름을 지도로 봅니다. 과열 지표, 신고가·신저가, 금리·거시 지표가 함께 붙습니다.',
    needsConfig: false,
  },
  {
    href: '/policy',
    icon: Landmark,
    label: '정책 · 뉴스',
    body: '정부 발표와 입법 동향을 요약하고, 관심 지역에 걸린 호재·악재와 주요 일정을 모읍니다.',
    needsConfig: false,
  },
  {
    href: '/settings',
    icon: Settings,
    label: '설정',
    body: '보유·목표 단지를 등록합니다. 단지를 고르면 세대수·용적률·대지지분·준공연도가 자동으로 채워집니다.',
    needsConfig: false,
  },
];

/** 계정 등급별로 열리는 범위 */
const ACCESS = [
  {
    tier: '로그인 없이',
    can: '시장 동향, 정책·뉴스를 그대로 볼 수 있습니다. 갈아타기·시뮬레이션 화면도 열리지만, 내 설정이 없으므로 기본 예시 단지 기준으로 표시됩니다.',
    cannot: '보유·목표 단지 등록, 브리핑 발송, AI 기능',
  },
  {
    tier: '가입 후 승인 대기',
    can: '위와 같습니다. 계정은 그대로 유지되고, 승인되면 바로 이어서 쓸 수 있습니다.',
    cannot: '설정 저장, 브리핑 발송, AI 기능',
  },
  {
    tier: '승인된 회원',
    can: '보유·목표 단지 등록, 내 기준 갈아타기·시뮬레이션, 카카오톡·텔레그램 브리핑까지 전부 열립니다.',
    cannot:
      'AI 기능은 설정에 본인 OpenAI API 키를 등록해야 열립니다 (비용이 각자에게 청구되기 때문)',
  },
];

/** 어떤 자료를 쓰는지 */
const SOURCES = [
  {
    name: '국토교통부 아파트 매매 실거래가',
    use: '시세·갭·세금 계산의 유일한 근거',
    via: '공공데이터포털',
  },
  { name: '한국부동산원', use: '주간 아파트 가격 동향', via: '공공데이터포털' },
  { name: '한국은행 ECOS', use: '기준금리·주택담보대출 금리', via: 'ECOS OpenAPI' },
  { name: '통계청 KOSIS', use: '인구·가구 등 구조 지표', via: 'KOSIS OpenAPI' },
  { name: '건축HUB 건축물대장', use: '세대수·용적률·대지지분·준공연도', via: '공공데이터포털' },
  { name: '네이버 검색', use: '뉴스·정책 발표 수집', via: '네이버 개발자센터' },
];

export default function GuidePage() {
  return (
    <div className="mx-auto max-w-[1100px] space-y-6 px-4 py-6">
      {/* --- 무엇을 하는 서비스인가 --- */}
      <section className="space-y-3">
        <Badge variant="secondary" className="rounded-full">
          소개 · 사용 가이드
        </Badge>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          지금 갈아타면, 내 현금이 얼마나 필요한가
        </h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          이사각은 “집을 옮길까” 고민을 숫자 하나로 좁혀 주는 도구입니다. 지금 사는 집과 가고 싶은
          집을 등록해 두면, 실거래가를 기준으로 두 집의 차액에 취득세·중개보수·양도소득세·대출
          한도를 모두 반영해{' '}
          <strong className="text-foreground">내가 실제로 준비해야 할 현금</strong>을 계산합니다.
          시장이 어디까지 왔는지, 정책이 어떻게 바뀌는지도 같은 화면에서 따라갑니다.
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Link href="/settings" className={buttonVariants({ size: 'sm' })}>
            단지 등록하고 시작하기
          </Link>
          <Link href="/market" className={buttonVariants({ size: 'sm', variant: 'outline' })}>
            먼저 시장부터 둘러보기
          </Link>
        </div>
      </section>

      {/* --- 3단계 시작 --- */}
      <SectionCard
        title="세 단계면 준비 끝"
        description="등록해야 하는 값은 다섯 개뿐이고, 나머지는 전부 자동으로 채워집니다."
      >
        <ol className="grid gap-4 sm:grid-cols-3">
          {[
            {
              step: '1',
              title: '계정 만들기',
              body: '가입 후 관리자 승인이 필요합니다. 승인 전에도 시장·정책 화면은 볼 수 있습니다.',
            },
            {
              step: '2',
              title: '보유·목표 단지 등록',
              body: '단지명을 검색해 평형을 고르면 세대수·용적률·대지지분·준공연도가 실거래와 건축물대장에서 자동으로 채워집니다.',
            },
            {
              step: '3',
              title: '취득 정보 입력',
              body: '취득일과 취득가액만 넣으면 양도세·취득세·대출 한도는 현행 세법으로 계산됩니다.',
            },
          ].map((s) => (
            <li key={s.step} className="space-y-1.5">
              <div className="bg-secondary text-secondary-foreground flex size-7 items-center justify-center rounded-full text-sm font-semibold">
                {s.step}
              </div>
              <p className="text-sm font-medium">{s.title}</p>
              <p className="text-muted-foreground text-sm leading-relaxed">{s.body}</p>
            </li>
          ))}
        </ol>
      </SectionCard>

      {/* --- 메뉴별 안내 --- */}
      <SectionCard title="메뉴별로 무엇을 보나" description="위쪽 메뉴 순서 그대로입니다.">
        <ul className="divide-y">
          {MENUS.map(({ href, icon: Icon, label, body, needsConfig }) => (
            <li key={href} className="flex gap-3 py-3 first:pt-0 last:pb-0">
              <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={href} className="text-sm font-medium hover:underline">
                    {label}
                  </Link>
                  {needsConfig ? (
                    <Badge variant="outline" className="text-[11px] font-normal">
                      내 단지 등록 필요
                    </Badge>
                  ) : null}
                </div>
                <p className="text-muted-foreground text-sm leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ul>
      </SectionCard>

      {/* --- 계정 등급 --- */}
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <UserCheck className="size-4" /> 계정에 따라 열리는 범위
          </span>
        }
        description="가입은 승인제입니다. 공공 API 호출량에 한도가 있어 무제한으로 열어 둘 수 없습니다."
      >
        <div className="space-y-3">
          {ACCESS.map((a) => (
            <div key={a.tier} className="rounded-md border p-3">
              <p className="text-sm font-medium">{a.tier}</p>
              <p className="text-muted-foreground mt-1 text-sm leading-relaxed">{a.can}</p>
              <p className="text-muted-foreground mt-1.5 flex items-start gap-1.5 text-sm leading-relaxed">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                <span>잠김 — {a.cannot}</span>
              </p>
            </div>
          ))}
        </div>
      </SectionCard>

      {/* --- 데이터 --- */}
      <SectionCard
        title={
          <span className="flex items-center gap-2">
            <Database className="size-4" /> 어떤 자료를 쓰나
          </span>
        }
        description={`화면은 ${REFRESH_LABEL}마다 다시 조립되고, 실거래는 하루 두 번 전국을 갱신한 뒤 내가 등록한 지역만 3시간마다 추가로 확인합니다.`}
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] text-sm">
            <thead className="text-muted-foreground border-b text-left">
              <tr>
                <th className="pb-2 font-medium">출처</th>
                <th className="pb-2 font-medium">쓰는 곳</th>
                <th className="pb-2 font-medium">경로</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {SOURCES.map((s) => (
                <tr key={s.name}>
                  <td className="py-2 pr-3 font-medium">{s.name}</td>
                  <td className="text-muted-foreground py-2 pr-3">{s.use}</td>
                  <td className="text-muted-foreground py-2">{s.via}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionCard>

      {/* --- 원칙 --- */}
      <SectionCard
        title="숫자를 다루는 원칙"
        description="결과를 믿을 수 있게 하려고 정한 규칙입니다."
      >
        <ul className="space-y-2.5 text-sm leading-relaxed">
          <li>
            <strong className="font-medium">돈이 걸린 계산은 실거래가만 씁니다.</strong>{' '}
            <span className="text-muted-foreground">
              호가는 검증할 방법이 없어 갭·세금 계산에 넣지 않습니다. 실거래가 없으면 “실거래
              없음”이라고 그대로 말합니다.
            </span>
          </li>
          <li>
            <strong className="font-medium">직거래는 시세에서 제외합니다.</strong>{' '}
            <span className="text-muted-foreground">
              가족 간 저가 이전이 섞이면 시세가 실제보다 낮게 잡힙니다.
            </span>
          </li>
          <li>
            <strong className="font-medium">공식 경로로만 자료를 받습니다.</strong>{' '}
            <span className="text-muted-foreground">
              부동산 포털은 이용약관에서 자동 수집을 금지합니다. 같은 정보를 정부·공공기관 OpenAPI
              로 모두 얻을 수 있어 그쪽만 씁니다.
            </span>
          </li>
          <li>
            <strong className="font-medium">세율은 현행 기준으로 계산합니다.</strong>{' '}
            <span className="text-muted-foreground">
              다만 규제지역 지정은 정부 공고로 수시로 바뀌므로 설정에서 직접 확인·수정할 수 있게
              열어 두었습니다.
            </span>
          </li>
        </ul>
      </SectionCard>

      {/* --- FAQ --- */}
      <SectionCard title="자주 묻는 것">
        <dl className="space-y-4 text-sm leading-relaxed">
          <div>
            <dt className="font-medium">부동산 앱에는 뜨는 신고가가 왜 여기엔 없나요?</dt>
            <dd className="text-muted-foreground mt-1">
              원천은 같은 국토교통부 자료지만 경로가 다릅니다. 부동산 앱은 국토부 실거래가
              공개시스템을 보고, 이사각은 공공데이터포털 OpenAPI 를 씁니다. OpenAPI 는 같은 거래를
              몇 시간 늦게 받습니다. 이 지연은 줄일 수 없어서, 대신 자료가 올라오면 늦어도 3시간
              안에 반영되도록 확인 주기를 잡아 두었습니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium">계약한 지 얼마 안 된 거래는 언제 보이나요?</dt>
            <dd className="text-muted-foreground mt-1">
              부동산 거래 신고 기한이 계약일로부터 30일입니다. 신고가 되어야 공개되므로, 계약일이 한
              달 가까이 지난 거래가 오늘 처음 뜨는 일이 흔합니다. 화면의 날짜는 신고일이 아니라
              계약일 기준입니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium">AI 기능은 왜 따로 키가 필요한가요?</dt>
            <dd className="text-muted-foreground mt-1">
              시황·정책 요약과 챗봇은 OpenAI 를 호출하고 호출한 만큼 비용이 듭니다. 비용이 남에게
              전가되지 않도록 회원은 설정에 본인 API 키를 등록해야 열리게 했습니다. 나머지 기능은
              모두 무료 공공 API 라 키 없이 씁니다.
            </dd>
          </div>
          <div>
            <dt className="font-medium">내 단지가 검색되지 않습니다.</dt>
            <dd className="text-muted-foreground mt-1">
              실거래에 등록된 이름과 부르는 이름이 다른 경우가 있습니다. 괄호 안에 층수 구분이
              붙거나(“상계주공7단지” → 국토부 “상계주공7(고층)”), 지역 이름이 빠진 채 등록되기도
              합니다. 최근 2년 실거래가 없는 단지는 목록에 뜨지 않을 수 있으니, 시군구를 먼저 고른
              뒤 짧은 이름으로 다시 검색해 보세요.
            </dd>
          </div>
        </dl>
      </SectionCard>

      <p className="text-muted-foreground pb-2 text-xs leading-relaxed">
        이사각이 보여 주는 숫자는 공개된 자료를 정해진 규칙으로 계산한 결과이며, 투자 권유나 세무
        자문이 아닙니다. 실제 계약·세금 신고 전에는 반드시 전문가의 확인을 받으세요.
      </p>
    </div>
  );
}
