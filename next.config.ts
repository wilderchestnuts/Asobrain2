import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  /**
   * The dev overlay defaults to bottom-left, which is exactly where the game's
   * primary action (Roll, and the build buttons) sits. It swallows taps there
   * in development — harmless in production, but it makes local play and
   * browser testing misleading. Move it out of the way rather than hiding it,
   * so compile and runtime errors are still surfaced.
   */
  devIndicators: {
    position: 'top-right',
  },
};

export default nextConfig;
