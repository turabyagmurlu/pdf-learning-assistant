/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // 3.0: kaldırılan rotalar Bugün'e yönlenir (eski yer imleri / PWA kısayolları boş sayfaya düşmesin)
  async redirects() {
    return [
      { source: "/atelier", destination: "/today", permanent: false },
      { source: "/atelier/:path*", destination: "/today", permanent: false },
    ];
  },
};
export default nextConfig;
