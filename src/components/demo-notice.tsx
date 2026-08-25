import Link from 'next/link';
import { Info } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';

/**
 * 예시 데이터 안내 — 로그인하지 않은 방문자에게만 보인다.
 *
 * 비로그인 요청은 레거시 공용 설정('default')으로 대시보드를 조립한다.
 * 그 화면에는 상계주공7단지·헬리오시티 같은 단지와 취득가·대출잔액이 그대로
 * 계산돼 나오는데, 아무 표시가 없으면 처음 온 사람은 그게 자기 값인 줄 알거나
 * 실제 누군가의 자산으로 오해한다. "예시"라고 먼저 말해 둔다.
 */
export function DemoNotice() {
  return (
    <Alert>
      <Info className="size-4" />
      <AlertTitle>예시 단지로 보고 계십니다</AlertTitle>
      <AlertDescription>
        로그인 전에는 기능을 보여드리기 위해 미리 입력해 둔 예시 단지(상계주공7단지 → 헬리오시티)로
        계산한 화면이 나옵니다. 실제 시세·세금·대출은 모두 진짜 자료로 계산하지만, 단지와 취득
        정보는 실제 보유 내역이 아닙니다.{' '}
        <Link href="/login" className="underline underline-offset-2">
          로그인하고 내 단지 등록하기 →
        </Link>
      </AlertDescription>
    </Alert>
  );
}
