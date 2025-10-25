import * as React from "react";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Banner } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import "nextra-theme-docs/style.css";

export const metadata = {
	title: "Superset Docs",
	description: "Superset Documentation",
};

const banner = (
	<Banner storageKey="superset-docs-banner">
		Welcome to Superset Documentation
	</Banner>
);

const navbar = <Navbar logo={<strong>Superset</strong>} />;

const footer = (
	<Footer>
		<p>
			© {new Date().getFullYear()} Superset. All rights reserved.
		</p>
	</Footer>
);

export default async function DocsLayout({
	children,
}: {
	children: React.ReactNode;
}) {
	return (
		<html lang="en" suppressHydrationWarning>
			<body>
				<Layout
					banner={banner}
					navbar={navbar}
					pageMap={await getPageMap()}
					docsRepositoryBase="https://github.com/yourusername/superset"
					footer={footer}
				>
					{children}
				</Layout>
			</body>
		</html>
	);
}
