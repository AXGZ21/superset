import type { NextConfig } from "next";
import nextra from "nextra";

const withNextra = nextra({
	defaultShowCopyCode: true,
});

const nextConfig: NextConfig = {
	reactStrictMode: true,
	transpilePackages: ["@superset/ui"],
};

export default withNextra(nextConfig);
