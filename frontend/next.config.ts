import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: false,
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Cross-Origin-Opener-Policy',
            value: 'same-origin',
          },
          {
            key: 'Cross-Origin-Embedder-Policy',
            value: 'require-corp',
          },
        ],
      },
    ];
  },
  webpack(config) {
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    config.experiments = { ...config.experiments, topLevelAwait: true };
    config.optimization.minimizer = []; // Disable minification to avoid some o1js build issues

    if (!config.resolve.fallback) {
      config.resolve.fallback = {};
    }

    config.resolve.fallback = {
      ...config.resolve.fallback,
      fs: false,
      path: false,
      crypto: false,
      os: false,
      child_process: false,
      worker_threads: false,
      stream: false,
    };

    return config;
  }
};

export default nextConfig;
