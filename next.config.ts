import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // This repo already has a CLAUDE.md with binding project context; `next dev`
  // otherwise appends a "nextjs-agent-rules" block to it on every dev run.
  agentRules: false,
};

export default nextConfig;
