import { NextResponse } from 'next/server';
import { buildDashboard } from '@/lib/pipeline/dashboard';
import { errorResponse } from '@/lib/api-auth';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const skipLive = url.searchParams.get('live') === '0';
    const data = await buildDashboard({ skipLive });
    return NextResponse.json({ ok: true, data });
  } catch (e) {
    return errorResponse(e);
  }
}
