import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfkit reads its standard-14 font metrics (.afm files) from disk
  // relative to its own module directory at runtime. Bundling it rewrites
  // that path incorrectly, so it must run as a plain, unbundled require().
  serverExternalPackages: ["pdfkit"],
};

export default nextConfig;
