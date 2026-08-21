import { ImageResponse } from 'next/og';
import { loadBriefingRender } from '@/lib/store/briefing-render';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * 브리핑 전문을 PNG 이미지로 렌더링한다.
 *
 * 카카오 text 템플릿은 200자 제한이라 전문(약 1,300자)이 안 들어가는데,
 * feed 템플릿의 이미지에는 글자 수 제한이 없다. 발송 시 저장해 둔
 * 브리핑(JSON)을 토큰으로 찾아 그리기만 하므로 카카오 수집기의
 * 짧은 타임아웃 안에 응답한다.
 *
 * GET /api/briefing/image?tk=<발송 시 발급된 토큰>
 */

/** 한글 폰트 — 자기 배포의 정적 파일에서 1회 로드해 모듈에 캐시 */
let fontCache: { regular: ArrayBuffer; bold: ArrayBuffer } | null = null;

async function loadFonts() {
  if (fontCache) return fontCache;
  const base = env.appUrl.replace(/\/$/, '');
  const [regular, bold] = await Promise.all([
    fetch(`${base}/fonts/NotoSansKR-Regular.otf`).then((r) => r.arrayBuffer()),
    fetch(`${base}/fonts/NotoSansKR-Bold.otf`).then((r) => r.arrayBuffer()),
  ]);
  fontCache = { regular, bold };
  return fontCache;
}

const WIDTH = 800;

export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get('tk') ?? '';
  if (!/^[0-9a-f-]{20,}$/i.test(token)) {
    return new Response('bad token', { status: 400 });
  }

  const briefing = await loadBriefingRender(token);
  if (!briefing) {
    return new Response('not found', { status: 404 });
  }

  const fonts = await loadFonts();

  // 줄 수로 높이를 계산한다 — 잘리는 것보다 여백이 낫다
  const lineCount = briefing.sections.reduce((n, s) => n + 1 + s.lines.length, 0);
  const height = Math.min(2200, 150 + lineCount * 34 + briefing.sections.length * 22 + 60);

  return new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#ffffff',
        padding: '36px 40px',
        fontFamily: 'NotoSansKR',
        color: '#1a1a1a',
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 10 }}>
        <div style={{ fontSize: 34, fontWeight: 700 }}>{briefing.title}</div>
        <div style={{ fontSize: 22, color: '#c0392b', marginTop: 6 }}>{briefing.headline}</div>
      </div>

      {briefing.sections.map((section) => (
        <div
          key={section.heading}
          style={{ display: 'flex', flexDirection: 'column', marginTop: 18 }}
        >
          <div style={{ fontSize: 24, fontWeight: 700, marginBottom: 4 }}>{section.heading}</div>
          {section.lines.map((line, i) => (
            <div
              key={i}
              style={{ display: 'flex', fontSize: 21, color: '#333333', lineHeight: 1.55 }}
            >
              <span style={{ color: '#999999', marginRight: 8 }}>·</span>
              <span>{line.length > 58 ? `${line.slice(0, 57)}…` : line}</span>
            </div>
          ))}
        </div>
      ))}

      <div style={{ display: 'flex', marginTop: 'auto', paddingTop: 20 }}>
        <div style={{ fontSize: 17, color: '#888888' }}>
          국토교통부 실거래가 · 한국부동산원 · 한국은행 ECOS — apartment-analy.vercel.app
        </div>
      </div>
    </div>,
    {
      width: WIDTH,
      height,
      fonts: [
        { name: 'NotoSansKR', data: fonts.regular, weight: 400 },
        { name: 'NotoSansKR', data: fonts.bold, weight: 700 },
      ],
    },
  );
}
