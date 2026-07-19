/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Cache dynamic route segments in the Client Cache for 30s instead of the
    // default 0s. With the default, every visibilitychange/focus event causes
    // the router to refetch server components — which is the "white flash / app
    // reloads when returning to the tab" symptom. 30s is long enough to absorb
    // tab switches and short enough to feel live.
    staleTimes: {
      dynamic: 30,
      static: 180,
    },
  },
};

export default nextConfig;
