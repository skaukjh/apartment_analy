/**
 * 페이지 전환 중 즉시 보여줄 뼈대.
 *
 * 이 앱의 페이지는 전부 서버에서 외부 API 를 모아 만드느라 수 초가 걸린다.
 * loading.tsx 가 없으면 Next.js 는 서버가 끝날 때까지 이전 화면을 그대로 두는데,
 * 모바일에서는 이게 "메뉴가 안 눌린다"로 느껴진다. 그래서 각 라우트에 이걸 깐다.
 */

export function PageSkeleton({ title }: { title: string }) {
  return (
    <div className="mx-auto max-w-[1600px] animate-pulse px-4 py-6">
      <div className="mb-6 flex items-center gap-3">
        <div className="bg-muted h-7 w-40 rounded" />
        <div className="bg-muted/60 h-5 w-24 rounded" />
      </div>

      <p className="text-muted-foreground mb-6 text-sm">{title} 불러오는 중…</p>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4">
            <div className="bg-muted mb-3 h-4 w-20 rounded" />
            <div className="bg-muted h-7 w-28 rounded" />
          </div>
        ))}
      </div>

      <div className="space-y-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-4">
            <div className="bg-muted mb-4 h-5 w-32 rounded" />
            <div className="space-y-2">
              <div className="bg-muted/70 h-4 w-full rounded" />
              <div className="bg-muted/70 h-4 w-5/6 rounded" />
              <div className="bg-muted/70 h-4 w-2/3 rounded" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
