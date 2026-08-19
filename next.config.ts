import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 상위 디렉터리의 package-lock.json 을 프로젝트 루트로 오인하지 않도록 고정
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
